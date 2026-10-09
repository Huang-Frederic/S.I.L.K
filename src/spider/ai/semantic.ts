/**
 * Semantic ranking with sentence embeddings: each candidate link title is
 * compared (cosine similarity) with an embedding of the target's title and
 * summary. Embeddings are cached, so titles seen on earlier pages are free.
 */
import { byScore, LexicalRanker } from './lexical';
import type { CandidateLink, Ranker, RankResult, TargetProfile } from './types';

export type EmbedderStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Turns texts into L2-normalized vectors. */
export interface Embedder {
  readonly status: EmbedderStatus;
  /** Starts loading the model; resolves when it is usable. */
  load(): Promise<void>;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class EmbedderUnavailableError extends Error {
  constructor(readonly status: EmbedderStatus) {
    super(`Embedding model is ${status}`);
    this.name = 'EmbedderUnavailableError';
  }
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Text the target is embedded from: "Title (description). Summary". */
export function targetText(target: TargetProfile): string {
  return `${target.title}. ${target.summary}`.slice(0, 1000);
}

export interface SemanticRankerOptions {
  /** Only the first N candidates (reading order) are embedded. */
  maxCandidates?: number;
  batchSize?: number;
}

export class SemanticRanker implements Ranker {
  private readonly cache = new Map<string, Float32Array>();
  private readonly maxCandidates: number;
  private readonly batchSize: number;

  constructor(
    private readonly embedder: Embedder,
    options: SemanticRankerOptions = {},
  ) {
    this.maxCandidates = options.maxCandidates ?? 400;
    this.batchSize = options.batchSize ?? 64;
  }

  async rank(target: TargetProfile, links: readonly CandidateLink[]): Promise<RankResult> {
    // Never block a hop on a model that is still downloading.
    if (this.embedder.status !== 'ready') throw new EmbedderUnavailableError(this.embedder.status);

    const candidates = [...links].sort((a, b) => a.order - b.order).slice(0, this.maxCandidates);
    const [targetVector] = await this.vectors([targetText(target)]);
    const vectors = await this.vectors(candidates.map((link) => link.title));
    const total = candidates.reduce((max, link) => Math.max(max, link.order + 1), 0);
    const scored = candidates
      .map((link, i) => {
        // Cosine similarity (vectors are normalized), a nudge towards early
        // links to break near-ties, and a penalty for disambiguation pages.
        const early = total > 1 ? 1 - link.order / total : 1;
        const score = dot(targetVector, vectors[i]) + 0.01 * early - (link.disambiguation ? 0.15 : 0);
        return { link, score };
      })
      .sort(byScore);
    return { scored, method: 'semantic' };
  }

  private async vectors(texts: string[]): Promise<Float32Array[]> {
    const missing = [...new Set(texts.filter((text) => !this.cache.has(text)))];
    for (let i = 0; i < missing.length; i += this.batchSize) {
      const batch = missing.slice(i, i + this.batchSize);
      const embedded = await this.embedder.embed(batch);
      batch.forEach((text, j) => this.cache.set(text, embedded[j]));
    }
    return texts.map((text) => this.cache.get(text)!);
  }
}

/**
 * Uses the semantic ranker when the model is ready and falls back to lexical
 * scores otherwise (still loading, failed to load, or failed mid-race).
 */
export class FallbackRanker implements Ranker {
  private broken = false;

  constructor(
    private readonly primary: Ranker,
    private readonly fallback: Ranker = new LexicalRanker(),
    private readonly onFallback?: (error: unknown) => void,
  ) {}

  async rank(target: TargetProfile, links: readonly CandidateLink[]): Promise<RankResult> {
    if (!this.broken) {
      try {
        return await this.primary.rank(target, links);
      } catch (error) {
        // A model that is merely loading may work on the next page; anything
        // else (load failure, inference error) disables it for the race.
        const transient = error instanceof EmbedderUnavailableError && error.status !== 'failed';
        if (!transient) this.broken = true;
        this.onFallback?.(error);
      }
    }
    return this.fallback.rank(target, links);
  }
}
