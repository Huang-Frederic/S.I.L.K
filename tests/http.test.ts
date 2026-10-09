import { describe, expect, it } from 'vitest';
import { HttpError, HttpQueue, NetworkError, parseRetryAfter } from '../src/wiki/http';

/** A fetch mock whose responses are released manually. */
function controllableFetch() {
  const pending: Array<{ url: string; resolve: (r: Response) => void }> = [];
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Promise<Response>((resolve) => pending.push({ url, resolve }));
  };
  return { fetchFn, pending, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HttpQueue', () => {
  it('never runs more than maxConcurrent requests at once', async () => {
    const { fetchFn, pending } = controllableFetch();
    const queue = new HttpQueue({ fetchFn, maxConcurrent: 3 });
    const results = ['a', 'b', 'c', 'd', 'e'].map((id) => queue.getText(`https://x/${id}`, { priority: true }));
    await flush();
    expect(pending).toHaveLength(3);
    expect(queue.inFlight).toBe(3);
    pending.shift()!.resolve(new Response('A'));
    await flush();
    await flush();
    expect(pending).toHaveLength(3); // d started once a finished
    while (pending.length) {
      pending.shift()!.resolve(new Response('ok'));
      await flush();
      await flush();
    }
    const texts = await Promise.all(results.map((p) => p.then((r) => r.text)));
    expect(texts[0]).toBe('A');
    expect(texts).toHaveLength(5);
  });

  it('keeps one slot free for priority requests', async () => {
    const { fetchFn, pending } = controllableFetch();
    const queue = new HttpQueue({ fetchFn, maxConcurrent: 3 });
    for (const id of ['a', 'b', 'c', 'd']) void queue.getText(`https://x/${id}`);
    await flush();
    // The spider's background traffic uses two slots at most...
    expect(pending.map((p) => p.url)).toEqual(['https://x/a', 'https://x/b']);
    // ...so the player's click starts at once.
    void queue.getText('https://x/click', { priority: true });
    await flush();
    expect(pending.map((p) => p.url)).toEqual(['https://x/a', 'https://x/b', 'https://x/click']);
  });

  it('runs priority requests before queued ones', async () => {
    const { fetchFn, pending } = controllableFetch();
    const queue = new HttpQueue({ fetchFn, maxConcurrent: 1 });
    void queue.getText('https://x/first');
    void queue.getText('https://x/normal');
    void queue.getText('https://x/urgent', { priority: true });
    await flush();
    pending.shift()!.resolve(new Response('1'));
    await flush();
    await flush();
    expect(pending[0].url).toBe('https://x/urgent');
  });

  it('promotes a queued request when a priority caller asks for it', async () => {
    const { fetchFn, pending } = controllableFetch();
    const queue = new HttpQueue({ fetchFn, maxConcurrent: 1 });
    void queue.getText('https://x/first');
    void queue.getText('https://x/spider-1');
    const prefetched = queue.getText('https://x/page');
    // The player clicks the page the spider had queued.
    const clicked = queue.getText('https://x/page', { priority: true });
    expect(clicked).toBe(prefetched);
    await flush();
    pending.shift()!.resolve(new Response('1'));
    await flush();
    await flush();
    expect(pending[0].url).toBe('https://x/page');
  });

  it("does not hold the player's first try behind a 429 back-off", async () => {
    const sleeps: number[] = [];
    let now = 0;
    const queue = new HttpQueue({
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetchFn: async (url) => (url.endsWith('busy') && now < 5000 ? new Response('slow down', { status: 429, headers: { 'retry-after': '5' } }) : new Response('ok')),
    });
    await queue.getText('https://x/busy');
    expect(sleeps).toEqual([5000]);
    now = 1000; // still inside the 5 s back-off window
    await queue.getText('https://x/click', { priority: true });
    expect(sleeps).toEqual([5000]);
    await queue.getText('https://x/background');
    expect(sleeps).toEqual([5000, 4000]);
  });

  it('caches responses and shares in-flight requests', async () => {
    let count = 0;
    const queue = new HttpQueue({
      fetchFn: async () => {
        count++;
        return new Response('hello');
      },
    });
    const [a, b] = await Promise.all([queue.getText('https://x/1'), queue.getText('https://x/1')]);
    await queue.getText('https://x/1');
    expect(a.text).toBe('hello');
    expect(b.text).toBe('hello');
    expect(count).toBe(1);
    await queue.getText('https://x/1', { noCache: true });
    expect(count).toBe(2);
  });

  it('sends the configured headers (Api-User-Agent)', async () => {
    const { fetchFn, pending, calls } = controllableFetch();
    const queue = new HttpQueue({ fetchFn, headers: { 'Api-User-Agent': 'SILK-test' } });
    const p = queue.getText('https://x/ua');
    await flush();
    pending[0].resolve(new Response('ok'));
    await p;
    expect(calls[0].headers['Api-User-Agent']).toBe('SILK-test');
  });

  it('waits for Retry-After on 429 and then retries', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const queue = new HttpQueue({
      sleep: async (ms) => void sleeps.push(ms),
      fetchFn: async () => {
        attempts++;
        return attempts === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }) : new Response('done');
      },
    });
    const response = await queue.getText('https://x/throttled');
    expect(response.text).toBe('done');
    expect(attempts).toBe(2);
    expect(sleeps[0]).toBe(7000);
  });

  it('retries network errors with a back-off, then gives up', async () => {
    const sleeps: number[] = [];
    const queue = new HttpQueue({
      maxRetries: 2,
      sleep: async (ms) => void sleeps.push(ms),
      fetchFn: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(queue.getText('https://x/down')).rejects.toBeInstanceOf(NetworkError);
    expect(sleeps).toEqual([5000, 10000]);
  });

  it('lets a request use its own retry budget', async () => {
    let attempts = 0;
    const queue = new HttpQueue({
      maxRetries: 3,
      sleep: async () => {},
      fetchFn: async () => {
        attempts++;
        return new Response('busy', { status: 503 });
      },
    });
    await expect(queue.getText('https://x/suggest', { maxRetries: 0 })).rejects.toBeInstanceOf(HttpError);
    expect(attempts).toBe(1);
  });

  it('does not retry client errors and does not cache failures', async () => {
    let attempts = 0;
    const queue = new HttpQueue({
      fetchFn: async () => {
        attempts++;
        return attempts === 1 ? new Response('nope', { status: 404 }) : new Response('found');
      },
    });
    const error = await queue.getText('https://x/missing').catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(attempts).toBe(1);
    expect((await queue.getText('https://x/missing')).text).toBe('found');
  });
});

describe('parseRetryAfter', () => {
  it('handles seconds, dates and garbage', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
