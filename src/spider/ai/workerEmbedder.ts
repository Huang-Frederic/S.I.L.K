/** Main-thread side of the embedding worker. */
import type { EmbedRequest, EmbedResponse } from './embedProtocol';
import { EmbedderUnavailableError, type Embedder, type EmbedderStatus } from './semantic';

export class WorkerEmbedder implements Embedder {
  status: EmbedderStatus = 'idle';
  /** Download progress of the model files, 0..1. */
  progress = 0;
  error: string | null = null;

  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    /** Hugging Face id of the model to run (see MODEL_IDS). */
    private readonly model: string,
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module', name: 'silk-embeddings' }),
  ) {}

  /** Subscribes to status/progress changes; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(): Promise<void> {
    this.loading ??= new Promise<void>((resolve, reject) => {
      this.setStatus('loading');
      let worker: Worker;
      try {
        worker = this.createWorker();
      } catch (error) {
        this.fail(String(error));
        reject(error);
        return;
      }
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<EmbedResponse>) => {
        const message = event.data;
        switch (message.type) {
          case 'progress':
            this.progress = Math.max(this.progress, message.fraction);
            this.emit();
            break;
          case 'ready':
            this.progress = 1;
            this.setStatus('ready');
            resolve();
            break;
          case 'error':
            this.fail(message.message);
            reject(new Error(message.message));
            break;
          case 'embedded': {
            const job = this.pending.get(message.id);
            this.pending.delete(message.id);
            job?.resolve(splitVectors(message.data, message.dim));
            break;
          }
          case 'embed-error': {
            const job = this.pending.get(message.id);
            this.pending.delete(message.id);
            job?.reject(new Error(message.message));
            break;
          }
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        const message = event.message || 'The embedding worker crashed';
        this.fail(message);
        reject(new Error(message));
      };
      worker.postMessage({ type: 'load', model: this.model } satisfies EmbedRequest);
    });
    return this.loading;
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const worker = this.worker;
    if (this.status !== 'ready' || !worker) return Promise.reject(new EmbedderUnavailableError(this.status));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed', id, texts } satisfies EmbedRequest);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private fail(message: string): void {
    this.error = message;
    this.setStatus('failed');
    for (const job of this.pending.values()) job.reject(new Error(message));
    this.pending.clear();
    this.dispose();
  }

  private setStatus(status: EmbedderStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function splitVectors(data: Float32Array, dim: number): Float32Array[] {
  const vectors: Float32Array[] = [];
  for (let offset = 0; offset < data.length; offset += dim) vectors.push(data.subarray(offset, offset + dim));
  return vectors;
}
