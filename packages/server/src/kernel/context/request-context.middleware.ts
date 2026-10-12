import type { NextFunction, Request, Response } from 'express';

import { newId } from '../ids/ids';
import { RequestContext } from './request-context';

/** Accept a caller's request id only if it is a sane token (no header injection, bounded). */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * First middleware of every request (BACKEND.md §4 step 2): takes `X-Request-Id` or makes a
 * UUIDv7, echoes it, and runs the rest of the request inside a RequestContext.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-request-id'];
  const requestId = typeof header === 'string' && VALID_REQUEST_ID.test(header) ? header : newId();
  res.setHeader('X-Request-Id', requestId);
  RequestContext.run({ requestId }, next);
}
