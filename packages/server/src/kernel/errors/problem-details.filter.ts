import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { PROBLEM_CONTENT_TYPE } from '@attendra/contracts';
import type { Response } from 'express';

import { RequestContext } from '../context/request-context';
import { toProblem } from './problem';

/**
 * Global exception filter: every error response is `application/problem+json`
 * (BACKEND.md §4 step 14, §11). Expected rejections log at `warn`, unexpected ones at
 * `error` with the stack.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception, RequestContext.requestId);

    if (problem.unexpected) {
      this.logger.error({ err: exception, errorCode: problem.body.code }, 'Unhandled error');
    } else if (problem.status !== 404) {
      // `errorCode`, not `code`: `code` is redacted in logs (it often holds OTPs).
      this.logger.warn(
        { errorCode: problem.body.code, status: problem.status },
        'Request rejected',
      );
    }

    if (res.headersSent) return;
    res.status(problem.status);
    for (const [name, value] of Object.entries(problem.headers)) res.setHeader(name, value);
    res.type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem.body));
  }
}
