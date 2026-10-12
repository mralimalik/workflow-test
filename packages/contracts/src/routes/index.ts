import type { RouteDefinition } from '../http/route';
import { accountRoutes } from './account';
import { userAuthRoutes } from './auth';
import { fileRoutes } from './files';
import { healthRoutes } from './health';

export {
  AUTH_METHODS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  currentUserSchema,
  loginResultSchema,
  passwordSchema,
  sessionInfoSchema,
  sessionListItemSchema,
  userSessionSchema,
  type CurrentUser,
  type UserSession,
} from './auth';
export { fileUploadResultSchema, IMAGE_CONTENT_TYPES } from './files';
export { healthResultSchema } from './health';

/** Every API route, grouped by area. The single registry the server and OpenAPI use. */
export const routes = {
  health: healthRoutes,
  files: fileRoutes,
  userAuth: userAuthRoutes,
  account: accountRoutes,
};

/** Flat list of every route in the registry. */
export const allRoutes: readonly RouteDefinition[] = Object.values(routes).flatMap((group) =>
  Object.values(group as Record<string, RouteDefinition>),
);
