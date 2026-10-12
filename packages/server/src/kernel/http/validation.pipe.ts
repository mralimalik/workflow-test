import { type ArgumentMetadata, Injectable, StandardSchemaValidationPipe } from '@nestjs/common';
import type { FieldError } from '@attendra/contracts';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { isAppError, ValidationError } from '../errors/app-error';

function pathOf(issue: StandardSchemaV1.Issue): string {
  return (issue.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)).join('.');
}

function codeOf(issue: StandardSchemaV1.Issue): string {
  const code: unknown = (issue as unknown as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : 'invalid';
}

function toFieldErrors(issues: readonly StandardSchemaV1.Issue[]): FieldError[] {
  return issues.map((issue) => ({
    path: pathOf(issue),
    // Zod issues carry a `code` (e.g. invalid_type, too_small); other libraries may not.
    code: codeOf(issue),
    message: issue.message,
  }));
}

const PREFIX: Partial<Record<ArgumentMetadata['type'], string>> = {
  query: 'query',
  param: 'params',
};

/**
 * Nest's built-in Standard Schema pipe (ADR-0013), configured to raise our
 * `422 validation_failed` with `errors[].path`. Body field paths are bare (`email`);
 * query and path parameters are prefixed (`query.limit`, `params.orgId`).
 */
@Injectable()
export class ContractValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({ exceptionFactory: (issues) => new ValidationError(toFieldErrors(issues)) });
  }

  override async transform<T = unknown>(value: T, metadata: ArgumentMetadata): Promise<T> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      const prefix = PREFIX[metadata.type];
      if (isAppError(error) && error.code === 'validation_failed' && prefix && error.fieldErrors) {
        throw new ValidationError(
          error.fieldErrors.map((e) => ({ ...e, path: e.path ? `${prefix}.${e.path}` : prefix })),
        );
      }
      throw error;
    }
  }
}
