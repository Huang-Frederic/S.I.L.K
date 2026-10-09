import { describe, expect, it } from 'vitest';
import { LexicalRanker, lexicalProfile, stem, tokenize } from '../../src/spider/ai/lexical';
import { EmbedderUnavailableError, FallbackRanker, SemanticRanker, targetText, type Embedder, type EmbedderStatus } from '../../src/spider/ai/semantic';
import type { CandidateLink, TargetProfile } from '../../src/spider/ai/types';
import { ConceptEmbedder } from '../helpers/conceptEmbedder';

const einstein: TargetProfile = {
  title: 'Albert Einstein',
  aliases: new Set(['Einstein']),
  summary: 'German-born theoretical physicist. He developed the theory of relativity.',
  backlinks: new Set(),
};

function links(...titles: string[]): CandidateLink[] {
  return titles.map((title, order) => ({ title, linkedTitle: title, text: title, order }));
}

describe('lexical scoring', () => {
  it('tokenizes and stems', () => {
    expect(tokenize('The Theories of Relativity, by Einstein')).toEqual(['theory', 'relativity', 'einstein']);
    expect(stem('physicists')).toBe('physicist');
    expect(stem('glass')).toBe('glass');
    expect(stem('genus')).toBe('genus');
    expect(tokenize('Café Über')).toEqual(['cafe', 'uber']);
  });

  it('weights title words above summary words', () => {
    const profile = lexicalProfile(einstein);
    expect(profile.weights.get('einstein')).toBe(3);
    expect(profile.weights.get('physicist')).toBe(1);
  });

  it('ranks related titles first', async () => {
    const { scored, method } = await new LexicalRanker().rank(einstein, links('Banana', 'Theory of relativity', 'Einstein family', 'Physicist'));
    expect(method).toBe('lexical');
    expect(scored[0].link.title).toBe('Einstein family');
    expect(scored.map((s) => s.link.title).slice(1, 3).sort()).toEqual(['Physicist', 'Theory of relativity']);
    expect(scored[3].link.title).toBe('Banana');
  });

  it('breaks ties in favour of earlier links and penalizes disambiguation pages', async () => {
    const candidates = links('Zebra', 'Yak');
    const { scored } = await new LexicalRanker().rank(einstein, candidates);
    expect(scored[0].link.title).toBe('Zebra');
    const withDisambig = [{ ...candidates[0], disambiguation: true }, candidates[1]];
    expect((await new LexicalRanker().rank(einstein, withDisambig)).scored[0].link.title).toBe('Yak');
  });
});

describe('SemanticRanker', () => {
  const observatory: TargetProfile = {
    title: 'Tidewatch Observatory',
    aliases: new Set(),
    summary: 'An observatory on top of a lighthouse.',
    backlinks: new Set(),
  };

  it('ranks by cosine similarity to the target title and summary', async () => {
    const ranker = new SemanticRanker(new ConceptEmbedder());
    const { scored, method } = await ranker.rank(observatory, links('Glass Quarry', 'Lantern Festival', 'Weavers Guild'));
    expect(method).toBe('semantic');
    expect(scored[0].link.title).toBe('Lantern Festival');
  });

  it('embeds the target once and caches link titles across pages', async () => {
    const embedder = new ConceptEmbedder();
    const ranker = new SemanticRanker(embedder);
    await ranker.rank(observatory, links('Glass Quarry', 'Lantern Festival'));
    await ranker.rank(observatory, links('Lantern Festival', 'Copper Lighthouse'));
    const embedded = embedder.calls.flat();
    expect(embedded.filter((t) => t === targetText(observatory))).toHaveLength(1);
    expect(embedded.filter((t) => t === 'Lantern Festival')).toHaveLength(1);
    expect(embedded).toContain('Copper Lighthouse');
  });

  it('embeds in batches and caps the number of candidates', async () => {
    const embedder = new ConceptEmbedder();
    const ranker = new SemanticRanker(embedder, { batchSize: 2, maxCandidates: 3 });
    const { scored } = await ranker.rank(observatory, links('A', 'B', 'C', 'D', 'E'));
    expect(scored).toHaveLength(3);
    expect(embedder.calls.slice(1).map((c) => c.length)).toEqual([2, 1]);
  });

  it('refuses to rank while the model is not ready', async () => {
    const embedder = new ConceptEmbedder();
    embedder.status = 'loading';
    await expect(new SemanticRanker(embedder).rank(observatory, links('A'))).rejects.toBeInstanceOf(EmbedderUnavailableError);
  });
});

describe('FallbackRanker', () => {
  class FlakyEmbedder implements Embedder {
    calls = 0;
    constructor(public status: EmbedderStatus) {}
    async load() {}
    async embed(texts: string[]) {
      this.calls++;
      if (this.status !== 'ready') throw new Error('not ready');
      return texts.map(() => new Float32Array([1, 0]));
    }
  }

  it('uses lexical scores while the model loads, then switches to semantic', async () => {
    const embedder = new FlakyEmbedder('loading');
    const fallbacks: unknown[] = [];
    const ranker = new FallbackRanker(new SemanticRanker(embedder), undefined, (e) => fallbacks.push(e));
    expect((await ranker.rank(einstein, links('Physics'))).method).toBe('lexical');
    embedder.status = 'ready';
    expect((await ranker.rank(einstein, links('Physics'))).method).toBe('semantic');
    expect(fallbacks).toHaveLength(1);
  });

  it('gives up on the model for good after a real failure', async () => {
    const embedder = new FlakyEmbedder('failed');
    const ranker = new FallbackRanker(new SemanticRanker(embedder));
    expect((await ranker.rank(einstein, links('Physics'))).method).toBe('lexical');
    embedder.status = 'ready';
    expect((await ranker.rank(einstein, links('Physics'))).method).toBe('lexical');
  });

  it('falls back when inference throws', async () => {
    const broken: Embedder = {
      status: 'ready',
      load: async () => {},
      embed: async () => {
        throw new Error('WASM out of memory');
      },
    };
    const ranker = new FallbackRanker(new SemanticRanker(broken));
    const { scored, method } = await ranker.rank(einstein, links('Banana', 'Einstein family'));
    expect(method).toBe('lexical');
    expect(scored[0].link.title).toBe('Einstein family');
  });
});
