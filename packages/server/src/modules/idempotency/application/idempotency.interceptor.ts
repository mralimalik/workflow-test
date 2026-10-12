import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { successStatus, type RouteDefinition } from '@attendra/contracts';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';

import { RequestContext } from '../../../kernel/context/request-context';
import { AppError, ValidationError } from '../../../kernel/errors/app-error';
import { CONTRACT_ROUTE } from '../../../kernel/http/contract-route';
import { Clock } from '../../../kernel/time/clock';
import { IdempotencyRepository } from '../infrastructure/idempotency.repository';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

/** Stable JSON: object keys sorted, so semantically equal bodies hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  // JSON.stringify(undefined) is undefined at runtime despite its declared type.
  return value === undefined ? 'null' : JSON.stringify(value);
}

/**
 * `Idempotency-Key` for contract routes marked `idempotent` (BACKEND.md §5.9): the first
 * request stores its (serialized) success response; replays with the same body return it
 * without re-running the handler; a different body → 422 `idempotency_key_reused`; a replay
 * while the first is still running → 409 `request_in_progress`. Failed requests free the key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly repository: IdempotencyRepository,
    private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const route = this.reflector.get<RouteDefinition | undefined>(
      CONTRACT_ROUTE,
      context.getHandler(),
    );
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[IDEMPOTENCY_HEADER];
    if (!route?.idempotent || header === undefined) return next.handle();
    return from(
      this.run(route, req, context.switchToHttp().getResponse<Response>(), String(header), next),
    );
  }

  private async run(
    route: RouteDefinition,
    req: Request,
    res: Response,
    key: string,
    next: CallHandler,
  ): Promise<unknown> {
    if (!KEY_FORMAT.test(key)) {
      throw new ValidationError([
        {
          path: 'headers.idempotency-key',
          code: 'invalid_format',
          message: 'Expected 16–128 characters [A-Za-z0-9_-]',
        },
      ]);
    }
    const actor = RequestContext.get()?.actor;
    const subject = actor ? `${actor.type}:${actor.id}` : `anon:${req.ip ?? 'unknown'}`;
    const scope = `${subject}:${route.method}:${route.id}`;
    const hash = createHash('sha256')
      .update(canonicalJson(req.body ?? null))
      .digest();

    const claim = await this.repository.claim(scope, key, hash, this.clock.now());
    if (!claim.claimed) {
      const existing = claim.existing;
      if (!existing.requestHash.equals(hash)) throw new AppError('idempotency_key_reused');
      if (existing.status === 'in_progress') throw new AppError('request_in_progress');
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? successStatus(route));
      return existing.responseBody;
    }

    try {
      const body: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.repository.complete(scope, key, successStatus(route), body);
      return body;
    } catch (error) {
      await this.repository.release(scope, key);
      throw error;
    }
  }
}
