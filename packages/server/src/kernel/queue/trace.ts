import { context, propagation, type Context } from '@opentelemetry/api';

import { RequestContext } from '../context/request-context';

/** Correlation to put into job data / outbox rows: request id + W3C traceparent. */
export function currentTraceContext(): { requestId?: string; traceparent?: string } {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const requestId = RequestContext.requestId;
  return {
    ...(requestId ? { requestId } : {}),
    ...(carrier['traceparent'] ? { traceparent: carrier['traceparent'] } : {}),
  };
}

/** The OpenTelemetry context a consumer should continue from. */
export function contextFrom(traceparent: string | undefined): Context {
  return traceparent ? propagation.extract(context.active(), { traceparent }) : context.active();
}
