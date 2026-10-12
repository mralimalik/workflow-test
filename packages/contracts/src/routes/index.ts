import type { RouteDefinition } from '../http/route';
import { fileRoutes } from './files';
import { healthRoutes } from './health';

export { fileUploadResultSchema, IMAGE_CONTENT_TYPES } from './files';
export { healthResultSchema } from './health';

/** Every API route, grouped by area. The single registry the server and OpenAPI use. */
export const routes = {
  health: healthRoutes,
  files: fileRoutes,
};

/** Flat list of every route in the registry. */
export const allRoutes: readonly RouteDefinition[] = Object.values(routes).flatMap((group) =>
  Object.values(group as Record<string, RouteDefinition>),
);
