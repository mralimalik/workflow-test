/**
 * @attendra/contracts — the single source of truth for API shapes (BACKEND.md §5).
 * Schemas, enums and ts-rest routers are added per feature, starting in milestone A1.
 */
export const API_VERSION = 'v1' as const;
export type ApiVersion = typeof API_VERSION;
