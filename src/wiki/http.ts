/**
 * A small HTTP layer shared by every Wikipedia request:
 *  - at most `maxConcurrent` requests in flight (Wikimedia asks for <= 3),
 *    one of them kept free for priority requests (the player's clicks) so
 *    that the spider's background traffic never makes the player wait,
 *  - an in-memory cache keyed by URL (in-flight requests are shared too; a
 *    queued request is promoted when a priority caller asks for it),
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

/** A request waiting for (or holding) a slot. */
interface Job {
  url: string;
  priority: boolean;
  start: () => void;
}

export class HttpQueue {
  private readonly fetchFn: FetchFn;
  private readonly maxConcurrent: number;
  private readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private active = 0;
  private readonly waiting: Job[] = [];
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
      if (cached) {
        if (options.priority) this.promote(url);
        return cached;
      }
    }
    const promise = this.schedule(url, (job) => this.fetchWithRetry(url, options.maxRetries ?? this.maxRetries, job), options.priority ?? false);
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

  /** Moves a queued request ahead of the background traffic (the player wants it now). */
  promote(url: string): void {
    const index = this.waiting.findIndex((job) => job.url === url);
    if (index < 0) return;
    const [job] = this.waiting.splice(index, 1);
    job.priority = true;
    this.enqueue(job);
    this.pump();
  }

  /** Background requests leave one slot free for priority ones. */
  private get backgroundLimit(): number {
    return this.maxConcurrent > 1 ? this.maxConcurrent - 1 : this.maxConcurrent;
  }

  private schedule<T>(url: string, task: (job: Job) => Promise<T>, priority: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        url,
        priority,
        start: () => {
          this.active++;
          task(job)
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.pump();
            });
        },
      };
      this.enqueue(job);
      this.pump();
    });
  }

  /** Priority jobs wait in arrival order, ahead of every background job. */
  private enqueue(job: Job): void {
    const firstBackground = this.waiting.findIndex((other) => !other.priority);
    if (job.priority && firstBackground >= 0) this.waiting.splice(firstBackground, 0, job);
    else this.waiting.push(job);
  }

  private pump(): void {
    while (this.waiting.length) {
      const next = this.waiting[0];
      if (this.active >= (next.priority ? this.maxConcurrent : this.backgroundLimit)) return;
      this.waiting.shift();
      next.start();
    }
  }

  private async fetchWithRetry(url: string, maxRetries: number, job: Job): Promise<FetchedText> {
    for (let attempt = 0; ; attempt++) {
      // After a 429 everybody waits, except the player's first try: one
      // request is not hammering, and it is what the player is staring at.
      const wait = job.priority && attempt === 0 ? 0 : this.backoffUntil - this.now();
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
