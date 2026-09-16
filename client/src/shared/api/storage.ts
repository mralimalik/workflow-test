/**
 * Thin localStorage-backed persistence used as a stand-in for a real backend.
 * Every repository built on top of this returns Promises so swapping the
 * implementation for real `fetch` calls later is a no-op for callers.
 */

const NAMESPACE = 'agent-studio'

function key(name: string): string {
  return `${NAMESPACE}:${name}`
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name))
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson<T>(name: string, value: T): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value))
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — fail silently,
    // the in-memory query cache still keeps the app usable for the session.
  }
}

export function removeJson(name: string): void {
  try {
    localStorage.removeItem(key(name))
  } catch {
    // ignore
  }
}

/** Simulates network latency so loading states are visible during learning/dev. */
export function networkDelay(ms = 120): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
