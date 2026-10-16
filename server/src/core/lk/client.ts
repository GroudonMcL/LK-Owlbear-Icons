import type { LkErrorBody } from "./types.js";

/** LegendKeeper answered with an error status. */
export class LkApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** LegendKeeper could not be reached (DNS, TLS, timeout, reset). */
export class LkNetworkError extends Error {}

export interface LkClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Longest Retry-After the client will wait out itself, in seconds. */
  maxRetryWaitSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class LkClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryWaitSeconds: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: LkClientOptions) {
    // Never call the global fetch as a method: Workers throws "Illegal invocation"
    // when its `this` is anything but the global scope.
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryWaitSeconds = options.maxRetryWaitSeconds ?? 5;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    // LegendKeeper's canonical routes end in "/" (others answer 308), so ask for
    // them directly rather than relying on how a runtime treats auth on redirects.
    const url = new URL(this.options.baseUrl + (path.endsWith("/") ? path : `${path}/`));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "follow",
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        const cause = (err as Error & { cause?: unknown }).cause;
        const detail = `${(err as Error).message}${cause ? ` (${String((cause as Error).message ?? cause)})` : ""}`;
        console.warn(`[legendkeeper] ${url.pathname} unreachable after ${attempt + 1} attempts: ${detail}`);
        throw new LkNetworkError(`LegendKeeper is unreachable: ${detail}`);
      }

      if (response.ok) return (await response.json()) as T;

      const body = (await response.json().catch(() => ({}))) as LkErrorBody;
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const error = new LkApiError(
        response.status,
        body.code ?? `HTTP_${response.status}`,
        body.message ?? response.statusText,
        body.requestId ?? response.headers.get("x-request-id") ?? undefined,
        retryAfter,
      );

      const transient = response.status === 429 || response.status >= 500;
      const waitable = response.status !== 429 || (retryAfter ?? 1) <= this.maxRetryWaitSeconds;
      if (transient && waitable && attempt < this.maxRetries) {
        await this.sleep(retryAfter !== undefined ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
      throw error;
    }
  }
}

function backoff(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}
