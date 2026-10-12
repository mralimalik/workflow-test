import { redactHeaders, redactValue } from './redact';

export interface RecordedExchange {
  readonly step: string;
  readonly method: string;
  readonly path: string;
  readonly requestHeaders: Record<string, string>;
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: unknown;
  readonly durationMs: number;
  readonly checks: readonly { readonly label: string; readonly ok: boolean }[];
}

export interface ScenarioResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** Expected status; a mismatch fails the scenario. */
  readonly expectStatus?: number;
}

const REPORTED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'location',
  'x-request-id',
  'retry-after',
];

/**
 * HTTP client for one scenario: keeps a cookie jar (sessions span steps), records every
 * exchange (redacted) for the report, and evaluates expectations without throwing so the
 * report shows the whole flow.
 */
export class ScenarioContext {
  readonly exchanges: RecordedExchange[] = [];
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  get failed(): boolean {
    return this.exchanges.some((e) => e.checks.some((c) => !c.ok));
  }

  async request(
    step: string,
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ScenarioResponse> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const started = performance.now();
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const durationMs = Math.round(performance.now() - started);

    for (const cookie of res.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      if (name) this.cookies.set(name.trim(), rest.join('='));
    }

    const text = await res.text();
    const body: unknown = parseBody(text, res.headers.get('content-type'));
    const checks =
      options.expectStatus === undefined
        ? []
        : [{ label: `status ${options.expectStatus}`, ok: res.status === options.expectStatus }];

    this.exchanges.push({
      step,
      method,
      path,
      requestHeaders: redactHeaders(headers),
      requestBody: redactValue(options.body, ['code']),
      status: res.status,
      responseHeaders: Object.fromEntries(
        REPORTED_RESPONSE_HEADERS.flatMap((h) => {
          const v = res.headers.get(h);
          return v === null ? [] : [[h, v]];
        }),
      ),
      responseBody: redactValue(body),
      durationMs,
      checks,
    });
    return { status: res.status, headers: res.headers, body };
  }

  /** Records an extra assertion against the last exchange. */
  check(label: string, ok: boolean): void {
    const last = this.exchanges.at(-1);
    if (!last) throw new Error('check() called before any request');
    (last.checks as { label: string; ok: boolean }[]).push({ label, ok });
  }
}

function parseBody(text: string, contentType: string | null): unknown {
  if (text === '') return undefined;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export interface Scenario {
  /** Short kebab-case id, used with `--only`. */
  readonly id: string;
  readonly title: string;
  /** Requirement ids covered (docs/product/requirements.md). */
  readonly requirements: readonly string[];
  run(ctx: ScenarioContext): Promise<void>;
}

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
