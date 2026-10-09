/**
 * A small HTTP layer shared by every Wikipedia request:
 *  - at most `maxConcurrent` requests in flight (Wikimedia asks for <= 3),
 *  - an in-memory cache keyed by URL (in-flight requests are shared too),
 *  - polite retries with back-off on 429 / 5xx / network errors,
 *  - the `Api-User-Agent` header identifying the game.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message = `Request failed with HTTP ${status}`,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(
    readonly url: string,
    cause?: unknown,
  ) {
    super('Network error: Wikipedia could not be reached', { cause });
    this.name = 'NetworkError';
  }
}

export interface FetchedText {
  /** Final URL after redirects (may be empty with some fetch mocks). */
  url: string;
  status: number;
  text: string;
}

export interface RequestOptions {
  /** Skip the cache (e.g. for random article lists). */
  noCache?: boolean;
  /** Jump ahead of queued requests (used for the player's page loads). */
  priority?: boolean;
  /** Overrides the queue's retry budget (e.g. 0 for autocomplete). */
  maxRetries?: number;
}

export interface HttpQueueOptions {
  fetchFn?: FetchFn;
  maxConcurrent?: number;
  headers?: Record<string, string>;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export class HttpQueue {
  private readonly fetchFn: FetchFn;
  private readonly maxConcurrent: number;
  private readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly cache = new Map<string, Promise<FetchedText>>();
  /** Global pause after a 429 so that we stop hammering the API. */
  private backoffUntil = 0;

  constructor(options: HttpQueueOptions = {}) {
    // `fetch` must be called unbound from `window`, hence the wrapper.
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.headers = options.headers ?? {};
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
  }

  /** Number of requests currently running (exposed for tests). */
  get inFlight(): number {
    return this.active;
  }

  getText(url: string, options: RequestOptions = {}): Promise<FetchedText> {
    if (!options.noCache) {
      const cached = this.cache.get(url);
      if (cached) return cached;
    }
    const promise = this.schedule(() => this.fetchWithRetry(url, options.maxRetries ?? this.maxRetries), options.priority ?? false);
    if (!options.noCache) {
      this.cache.set(url, promise);
      // Failed requests must not poison the cache.
      promise.catch(() => {
        if (this.cache.get(url) === promise) this.cache.delete(url);
      });
    }
    return promise;
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.getText(url, options);
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new HttpError(response.status, url, 'Malformed JSON response');
    }
  }

  private schedule<T>(task: () => Promise<T>, priority: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.waiting.shift()?.();
          });
      };
      if (this.active < this.maxConcurrent) run();
      else if (priority) this.waiting.unshift(run);
      else this.waiting.push(run);
    });
  }

  private async fetchWithRetry(url: string, maxRetries: number): Promise<FetchedText> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.backoffUntil - this.now();
      if (wait > 0) await this.sleep(wait);

      let response: Response;
      try {
        response = await this.fetchFn(url, { headers: this.headers });
      } catch (error) {
        // A throttled cross-origin response without CORS headers surfaces as
        // a network error, so treat it like a rate limit: wait, then retry.
        if (attempt >= maxRetries) throw new NetworkError(url, error);
        await this.sleep(this.backoffDelay(attempt));
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) throw new HttpError(response.status, url);
        const delay = Math.min(
          parseRetryAfter(response.headers.get('retry-after'), this.now()) ?? this.backoffDelay(attempt),
          30_000,
        );
        if (response.status === 429) this.backoffUntil = Math.max(this.backoffUntil, this.now() + delay);
        await this.sleep(delay);
        continue;
      }

      const text = await response.text();
      if (!response.ok) throw new HttpError(response.status, url);
      return { url: response.url || url, status: response.status, text };
    }
  }

  /** Linear back-off (5 s, 10 s, 15 s): Wikimedia asks for >= 5 s after a throttle. */
  private backoffDelay(attempt: number): number {
    return Math.min(5000 * (attempt + 1), 15_000);
  }
}
