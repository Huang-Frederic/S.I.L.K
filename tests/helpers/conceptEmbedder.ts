/**
 * A deterministic stand-in for the sentence-embedding model: each dimension is
 * a "concept" (a bag of related words), so texts about lighthouses end up
 * close to texts about lanterns, and far from texts about quarries.
 */
import type { Embedder, EmbedderStatus } from '../../src/spider/ai/semantic';

const CONCEPTS: string[][] = [
  ['observatory', 'telescope', 'star', 'tide', 'tidewatch', 'sky', 'moon', 'moonlit', 'night'],
  ['lighthouse', 'light', 'lantern', 'lamp', 'beacon', 'copper', 'festival'],
  ['silk', 'spider', 'web', 'thread', 'weaver', 'weavers', 'loom', 'moth', 'spindle'],
  ['sea', 'reef', 'harbour', 'ferry', 'canal', 'causeway', 'isle', 'isles', 'amber'],
  ['stone', 'quarry', 'glass', 'foundry', 'windmill', 'bridge', 'row'],
  ['book', 'archive', 'library', 'monastery', 'market', 'saltwind', 'guild'],
];

export function conceptVector(text: string): Float32Array {
  const v = new Float32Array(CONCEPTS.length + 1);
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    CONCEPTS.forEach((concept, i) => {
      if (concept.includes(word)) v[i] += 1;
    });
  }
  v[CONCEPTS.length] = 0.2; // keeps unrelated texts from being zero vectors
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

export class ConceptEmbedder implements Embedder {
  status: EmbedderStatus = 'ready';
  readonly calls: string[][] = [];

  async load(): Promise<void> {
    this.status = 'ready';
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls.push(texts);
    return texts.map(conceptVector);
  }
}
