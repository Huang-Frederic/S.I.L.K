import { describe, expect, it } from 'vitest';
import type { EmbedRequest, EmbedResponse } from '../../src/spider/ai/embedProtocol';
import { EmbedderUnavailableError } from '../../src/spider/ai/semantic';
import { WorkerEmbedder } from '../../src/spider/ai/workerEmbedder';

/** Just enough of a Worker to talk to WorkerEmbedder. */
class FakeWorker {
  onmessage: ((event: MessageEvent<EmbedResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: EmbedRequest[] = [];
  terminated = false;

  postMessage(message: EmbedRequest): void {
    this.received.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: EmbedResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<EmbedResponse>);
  }
}

function setup() {
  const worker = new FakeWorker();
  const embedder = new WorkerEmbedder('test/model', () => worker as unknown as Worker);
  return { worker, embedder };
}

describe('WorkerEmbedder', () => {
  it('loads the model and reports progress', async () => {
    const { worker, embedder } = setup();
    const changes: string[] = [];
    embedder.onChange(() => changes.push(`${embedder.status}:${embedder.progress.toFixed(1)}`));
    const loading = embedder.load();
    expect(embedder.status).toBe('loading');
    expect(worker.received).toEqual([{ type: 'load', model: 'test/model' }]);
    worker.reply({ type: 'progress', fraction: 0.5 });
    worker.reply({ type: 'ready' });
    await loading;
    expect(embedder.status).toBe('ready');
    expect(changes).toEqual(['loading:0.0', 'loading:0.5', 'ready:1.0']);
    expect(embedder.load()).toBe(loading);
  });

  it('splits the flat result into one vector per text', async () => {
    const { worker, embedder } = setup();
    const loading = embedder.load();
    worker.reply({ type: 'ready' });
    await loading;
    const result = embedder.embed(['a', 'b']);
    const request = worker.received[1] as Extract<EmbedRequest, { type: 'embed' }>;
    expect(request.texts).toEqual(['a', 'b']);
    worker.reply({ type: 'embedded', id: request.id, data: new Float32Array([1, 0, 0, 1]), dim: 2 });
    expect((await result).map((v) => Array.from(v))).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('refuses to embed before the model is ready', async () => {
    const { embedder } = setup();
    await expect(embedder.embed(['a'])).rejects.toBeInstanceOf(EmbedderUnavailableError);
  });

  it('fails cleanly when the model cannot be loaded', async () => {
    const { worker, embedder } = setup();
    const loading = embedder.load();
    worker.reply({ type: 'error', message: 'CDN unreachable' });
    await expect(loading).rejects.toThrow('CDN unreachable');
    expect(embedder.status).toBe('failed');
    expect(embedder.error).toBe('CDN unreachable');
    expect(worker.terminated).toBe(true);
  });

  it('fails when the worker cannot even be created', async () => {
    const embedder = new WorkerEmbedder('test/model', () => {
      throw new Error('Workers are disabled');
    });
    await expect(embedder.load()).rejects.toThrow('Workers are disabled');
    expect(embedder.status).toBe('failed');
  });
});
