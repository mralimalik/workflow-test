import type { RouteDefinition } from '../http/route';
import { healthRoutes } from './health';

export { healthResultSchema } from './health';

/** Every API route, grouped by area. The single registry the server and OpenAPI use. */
export const routes = {
  health: healthRoutes,
};

/** Flat list of every route in the registry. */
export const allRoutes: readonly RouteDefinition[] = Object.values(routes).flatMap((group) =>
  Object.values(group as Record<string, RouteDefinition>),
);
