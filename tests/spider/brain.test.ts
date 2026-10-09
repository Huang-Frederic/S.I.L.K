import { describe, expect, it } from 'vitest';
import { SpiderBrain } from '../../src/spider/ai/brain';
import { LexicalRanker } from '../../src/spider/ai/lexical';
import { SemanticRanker } from '../../src/spider/ai/semantic';
import type { CandidateLink, Ranker, TargetProfile } from '../../src/spider/ai/types';
import { ConceptEmbedder } from '../helpers/conceptEmbedder';

function links(...titles: string[]): CandidateLink[] {
  return titles.map((title, order) => ({ title, linkedTitle: title, text: title, order }));
}

function target(overrides: Partial<TargetProfile> = {}): TargetProfile {
  return {
    title: 'Tidewatch Observatory',
    aliases: new Set(['Observatory of Tidewatch']),
    summary: 'Lighthouse-top observatory. Tidewatch Observatory watches the tides and the night sky.',
    backlinks: new Set(['Copper Lighthouse', 'Moonlit Causeway', 'Spider silk']),
    ...overrides,
  };
}

/** A ranker that scores by a fixed table and records what it was asked. */
class TableRanker implements Ranker {
  readonly asked: string[][] = [];
  constructor(private readonly table: Record<string, number>) {}
  async rank(_target: TargetProfile, candidates: readonly CandidateLink[]) {
    this.asked.push(candidates.map((l) => l.title));
    const scored = candidates.map((link) => ({ link, score: this.table[link.title] ?? 0 })).sort((a, b) => b.score - a.score);
    return { scored, method: 'semantic' as const };
  }
}

describe('SpiderBrain', () => {
  it('takes the target when it is linked', async () => {
    const brain = new SpiderBrain(target(), new TableRanker({ 'Glass Quarry': 9 }));
    const decision = await brain.decide(links('Glass Quarry', 'Tidewatch Observatory', 'Copper Lighthouse'));
    expect(decision.reason).toBe('target');
    expect(decision.link?.title).toBe('Tidewatch Observatory');
  });

  it('recognises the target behind a redirect alias', async () => {
    const brain = new SpiderBrain(target(), new TableRanker({}));
    const candidates: CandidateLink[] = [{ title: 'Observatory of Tidewatch', linkedTitle: 'Observatory of Tidewatch', text: 'the observatory', order: 0 }];
    const decision = await brain.decide(candidates);
    expect(decision.reason).toBe('target');
  });

  it('prefers pages that link to the target, ranked among themselves', async () => {
    const ranker = new TableRanker({ 'Glass Quarry': 9, 'Spider silk': 0.2, 'Copper Lighthouse': 0.8 });
    const brain = new SpiderBrain(target(), ranker);
    const decision = await brain.decide(links('Glass Quarry', 'Spider silk', 'Copper Lighthouse'));
    expect(decision.reason).toBe('backlink');
    expect(decision.link?.title).toBe('Copper Lighthouse');
    // Only the bridges were ranked.
    expect(ranker.asked).toEqual([['Spider silk', 'Copper Lighthouse']]);
  });

  it('otherwise follows the most similar link', async () => {
    const brain = new SpiderBrain(target(), new SemanticRanker(new ConceptEmbedder()));
    const decision = await brain.decide(links('Glass Quarry', 'Saltwind Market', 'Lantern Festival', 'Weavers Guild'));
    expect(decision.reason).toBe('semantic');
    expect(decision.link?.title).toBe('Lantern Festival');
    expect(decision.shortlist.length).toBeGreaterThan(1);
    expect(decision.shortlist[0].score).toBeGreaterThanOrEqual(decision.shortlist[1].score);
  });

  it('never chooses a visited page, even through another title', async () => {
    const brain = new SpiderBrain(target(), new TableRanker({ 'Lantern Festival': 5, 'Glass Quarry': 1 }));
    brain.visit('Lantern Festival');
    const decision = await brain.decide(links('Lantern Festival', 'Glass Quarry'));
    expect(decision.link?.title).toBe('Glass Quarry');

    brain.visit('Glass Quarry');
    const viaRedirect: CandidateLink[] = [{ title: 'Quarry of Glass', linkedTitle: 'Glass Quarry', text: 'quarry', order: 0 }];
    expect((await brain.decide(viaRedirect)).reason).toBe('dead-end');
  });

  it('reports a dead end when every link was visited', async () => {
    const brain = new SpiderBrain(target(), new LexicalRanker());
    brain.visit('Silk');
    const decision = await brain.decide(links('Silk', 'Silk'));
    expect(decision).toEqual({ reason: 'dead-end', link: null, score: 0, shortlist: [] });
    expect((await brain.decide([])).reason).toBe('dead-end');
  });

  it('deduplicates links to the same page', () => {
    const brain = new SpiderBrain(target(), new LexicalRanker());
    const fresh = brain.freshLinks([
      { title: 'Silk', linkedTitle: 'Silk', text: 'silk', order: 0 },
      { title: 'Silk', linkedTitle: 'Silks', text: 'silks', order: 3 },
      { title: 'Moth Orchard', linkedTitle: 'Moth Orchard', text: 'orchard', order: 5 },
    ]);
    expect(fresh.map((l) => [l.title, l.order])).toEqual([
      ['Silk', 0],
      ['Moth Orchard', 5],
    ]);
  });
});
