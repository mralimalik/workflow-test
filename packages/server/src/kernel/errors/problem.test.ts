import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  AppError,
  isAppError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from './app-error';
import { toProblem } from './problem';

describe('toProblem (RFC 9457)', () => {
  it('maps an AppError with its stable code, status and field errors', () => {
    const p = toProblem(
      new ValidationError([{ path: 'email', code: 'invalid_format', message: 'Bad' }]),
      'r1',
    );
    expect(p.status).toBe(422);
    expect(p.unexpected).toBe(false);
    expect(p.body).toEqual({
      type: 'https://docs.attendra.com/errors/validation_failed',
      title: 'The request is invalid',
      status: 422,
      code: 'validation_failed',
      detail: null,
      requestId: 'r1',
      errors: [{ path: 'email', code: 'invalid_format', message: 'Bad' }],
    });
  });

  it('carries detail and headers', () => {
    expect(
      toProblem(new NotFoundError('not_found', 'No such booking'), undefined).body.detail,
    ).toBe('No such booking');
    expect(toProblem(new RateLimitedError(2.2), 'r').headers).toEqual({ 'Retry-After': '3' });
  });

  it('maps framework HTTP errors to stable codes', () => {
    expect(toProblem(new NotFoundException(), 'r').body.code).toBe('route_not_found');
    expect(toProblem(new BadRequestException(), 'r').body.code).toBe('malformed_request');
    expect(toProblem(new PayloadTooLargeException(), 'r').status).toBe(413);
  });

  it('maps exposable client errors from body-parser', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    expect(toProblem(err, 'r').body.code).toBe('malformed_request');
  });

  it('turns unknown errors into 500 internal_error without leaking the message', () => {
    const p = toProblem(new Error('connection string postgres://secret'), 'req-9');
    expect(p).toMatchObject({ status: 500, unexpected: true });
    expect(p.body).toMatchObject({ code: 'internal_error', requestId: 'req-9', detail: null });
    expect(JSON.stringify(p.body)).not.toContain('secret');
    // A status on a non-exposable error is not trusted.
    expect(toProblem(Object.assign(new Error('x'), { status: 404 }), 'r').status).toBe(500);
  });

  it('recognises AppErrors from another module instance (brand, not instanceof)', () => {
    const foreign = Object.assign(new Error('x'), {
      [Symbol.for('attendra.AppError')]: true,
      code: 'conflict',
      status: 409,
      detail: undefined,
      fieldErrors: undefined,
      headers: undefined,
    });
    expect(isAppError(foreign)).toBe(true);
    expect(toProblem(foreign, 'r').status).toBe(409);
    expect(isAppError(new Error('plain'))).toBe(false);
  });

  it('treats 5xx AppErrors as unexpected', () => {
    expect(toProblem(new AppError('provider_unavailable'), 'r').unexpected).toBe(true);
  });
});
