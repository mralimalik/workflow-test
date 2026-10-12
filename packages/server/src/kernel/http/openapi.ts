import {
  API_VERSION,
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  problemSchema,
  successStatus,
  type ErrorCode,
  type RouteDefinition,
} from '@attendra/contracts';
import {
  createDocument,
  type ZodOpenApiObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';

/** The generated OpenAPI 3.1 document. */
export type OpenApiDocument = ReturnType<typeof createDocument>;

type StatusKey = `${1 | 2 | 3 | 4 | 5}${string}`;

export interface OpenApiOptions {
  title: string;
  version: string;
  serverUrl: string;
  /** Include routes marked `internal` (health etc.). */
  includeInternal: boolean;
}

type Method = Lowercase<RouteDefinition['method']>;

/** Error codes every route can return. */
function implicitErrors(route: RouteDefinition): ErrorCode[] {
  const codes: ErrorCode[] = ['internal_error'];
  const r = route.request;
  if (r && (r.body || r.query || r.params || r.headers)) codes.push('validation_failed');
  if (r?.body) codes.push('malformed_request', 'payload_too_large');
  if (route.versioned) codes.push('version_mismatch', 'precondition_required');
  return codes;
}

function responsesFor(route: RouteDefinition): ZodOpenApiResponsesObject {
  const responses: Record<StatusKey, ZodOpenApiResponseObject> = {};
  for (const [status, response] of Object.entries(route.responses)) {
    const isError = Number(status) >= 400;
    responses[status as StatusKey] = {
      description: response.description,
      ...(response.schema
        ? {
            content: {
              [isError ? PROBLEM_CONTENT_TYPE : 'application/json']: { schema: response.schema },
            },
          }
        : {}),
    };
  }

  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of [...implicitErrors(route), ...(route.errors ?? [])]) {
    const status = ERROR_CODES[code].status;
    byStatus.set(status, [...new Set([...(byStatus.get(status) ?? []), code])]);
  }
  for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b)) {
    const key = String(status) as StatusKey;
    if (key in responses) continue;
    responses[key] = {
      description: codes.map((c) => `\`${c}\` — ${ERROR_CODES[c].title}`).join('; '),
      content: { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } },
    };
  }
  return responses;
}

function operationFor(route: RouteDefinition): ZodOpenApiOperationObject {
  const r = route.request;
  successStatus(route); // asserts exactly one 2xx
  return {
    operationId: route.id,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    tags: [...route.tags],
    ...(r?.params || r?.query || r?.headers
      ? {
          requestParams: {
            ...(r.params ? { path: r.params } : {}),
            ...(r.query ? { query: r.query } : {}),
            ...(r.headers ? { header: r.headers } : {}),
          },
        }
      : {}),
    ...(r?.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: r.body } } } }
      : {}),
    responses: responsesFor(route),
    ...(route.idempotent ? { 'x-idempotent': true } : {}),
  };
}

/** OpenAPI 3.1 document generated from the route registry with zod-openapi (ADR-0014). */
export function buildOpenApiDocument(
  routes: readonly RouteDefinition[],
  options: OpenApiOptions,
): OpenApiDocument {
  const paths: ZodOpenApiPathsObject = {};
  for (const route of routes) {
    if (route.internal && !options.includeInternal) continue;
    const item = (paths[route.path] ??= {});
    const method = route.method.toLowerCase() as Method;
    if (item[method]) throw new Error(`Duplicate route ${route.method} ${route.path}`);
    item[method] = operationFor(route);
  }

  const document: ZodOpenApiObject = {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description: `Attendra API ${API_VERSION}`,
    },
    servers: [{ url: options.serverUrl }],
    paths,
  };
  return createDocument(document, { reused: 'ref' });
}
