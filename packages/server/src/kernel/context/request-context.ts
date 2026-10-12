import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is acting. `system` covers jobs, relays and CLIs. */
export type Actor =
  | { readonly type: 'user'; readonly id: string }
  | { readonly type: 'customer'; readonly id: string }
  | { readonly type: 'platform_admin'; readonly id: string }
  | { readonly type: 'api_key'; readonly id: string }
  | { readonly type: 'system'; readonly id: string };

export interface RequestContextStore {
  readonly requestId: string;
  actor?: Actor;
  organizationId?: string;
  locationId?: string;
  /** Background job context (worker). */
  jobId?: string;
  queue?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Per-request (or per-job) context carried through async calls with Node's
 * `AsyncLocalStorage` (BACKEND.md §4, §8.1). Read anywhere — logs, services, the DB
 * layer — without passing it around.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  get requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /** Adds facts learned during the request (actor after auth, tenant after the tenant guard). */
  assign(values: Partial<Omit<RequestContextStore, 'requestId'>>): void {
    const store = storage.getStore();
    if (!store) throw new Error('RequestContext.assign() called outside a request context');
    Object.assign(store, values);
  },
};
