import {
  applyDecorators,
  Body,
  HttpCode,
  Param,
  Query,
  RequestMapping,
  RequestMethod,
  SerializeOptions,
  SetMetadata,
} from '@nestjs/common';
import { successStatus, toExpressPath, type RouteDefinition } from '@attendra/contracts';

/** Metadata key under which a handler's route definition is stored. */
export const CONTRACT_ROUTE = 'attendra:contract-route';

const METHODS: Record<RouteDefinition['method'], RequestMethod> = {
  GET: RequestMethod.GET,
  POST: RequestMethod.POST,
  PUT: RequestMethod.PUT,
  PATCH: RequestMethod.PATCH,
  DELETE: RequestMethod.DELETE,
};

/**
 * Mounts a handler for a contract route (ADR-0014): method + path, success status, and
 * response serialization through the route's success schema. Controllers carry no path of
 * their own; the registry path is the full path.
 */
export function ContractRoute(route: RouteDefinition): MethodDecorator {
  const status = successStatus(route);
  const responseSchema = route.responses[status]?.schema;
  return applyDecorators(
    RequestMapping({ path: toExpressPath(route.path), method: METHODS[route.method] }),
    HttpCode(status),
    SetMetadata(CONTRACT_ROUTE, route),
    ...(responseSchema ? [SerializeOptions({ schema: responseSchema })] : []),
  );
}

function required<T>(schema: T | undefined, route: RouteDefinition, part: string): T {
  if (!schema) throw new Error(`Route ${route.id} declares no request ${part} schema`);
  return schema;
}

/** The request body, validated and parsed with the route's body schema. */
export const ContractBody = (route: RouteDefinition): ParameterDecorator =>
  Body({ schema: required(route.request?.body, route, 'body') });

/** Path parameters, validated and parsed with the route's params schema. */
export const ContractParams = (route: RouteDefinition): ParameterDecorator =>
  Param({ schema: required(route.request?.params, route, 'params') });

/** Query string, validated and parsed with the route's query schema. */
export const ContractQuery = (route: RouteDefinition): ParameterDecorator =>
  Query({ schema: required(route.request?.query, route, 'query') });
