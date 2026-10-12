/**
 * @attendra/contracts — the single source of truth for API shapes (BACKEND.md §5,
 * ADR-0014). Depends only on Zod.
 */
export const API_VERSION = 'v1' as const;
export type ApiVersion = typeof API_VERSION;

export * from './errors';
export * from './common/problem';
export * from './common/primitives';
export * from './common/pagination';
export * from './http/route';
export * from './routes';
export * from './events';
