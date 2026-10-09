/**
 * End-to-end tests of the spider's pathfinding against a mocked Wikipedia
 * (REST HTML + Action API served by FakeWiki through the real client).
 */
import { describe, expect, it } from 'vitest';
import { runSpiderSearch, SpiderAgent } from '../../src/spider/ai/agent';
import { SpiderBrain } from '../../src/spider/ai/brain';
import { LexicalRanker } from '../../src/spider/ai/lexical';
import { FallbackRanker, SemanticRanker } from '../../src/spider/ai/semantic';
import type { Ranker } from '../../src/spider/ai/types';
import { buildCandidates, buildTargetProfile, createPageLoader } from '../../src/spider/world';
import { ArticleStore } from '../../src/wiki/articles';
import { ArticleNotFoundError, WikiClient } from '../../src/wiki/client';
import { HttpQueue, type FetchFn } from '../../src/wiki/http';
import { ConceptEmbedder } from '../helpers/conceptEmbedder';
import { demoPages } from '../helpers/demoWorld';
import { FakeWiki, type FakePage } from '../helpers/fakeWiki';

const isMissing = (error: unknown) => error instanceof ArticleNotFoundError;

async function race(options: {
  pages?: FakePage[];
  start: string;
  target: string;
  ranker?: Ranker;
  fetchFn?: (wiki: FakeWiki) => FetchFn;
  maxHops?: number;
}) {
  const wiki = new FakeWiki(options.pages ?? demoPages());
  const fetchFn = options.fetchFn?.(wiki) ?? wiki.fetch;
  const client = new WikiClient({ http: new HttpQueue({ fetchFn, sleep: async () => {}, maxRetries: 1 }) });
  const store = new ArticleStore(client);
  const targetInfo = (await client.fetchPageInfo([options.target]).catch(() => null))?.get(options.target) ?? {
    requested: options.target,
    title: options.target,
    exists: true,
    disambiguation: false,
    extract: '',
    description: '',
    length: 0,
  };
  const profile = await buildTargetProfile(client, targetInfo);
  const brain = new SpiderBrain(profile, options.ranker ?? new SemanticRanker(new ConceptEmbedder()));
  const agent = new SpiderAgent(brain, createPageLoader(store, client), options.maxHops);
  const outcome = await runSpiderSearch(agent, options.start, isMissing);
  return { outcome, wiki, profile, titles: outcome.steps.map((s) => s.title) };
}

/** Builds a page whose lead links to the given titles. */
function page(title: string, links: string[], extra: Partial<FakePage> = {}): FakePage {
  return { title, lead: [`${title} is linked to ${links.map((l) => `[[${l}]]`).join(', ') || 'nothing'}.`], ...extra };
}

describe('spider search (mocked Wikipedia)', () => {
  it('reaches the target without ever revisiting a page', async () => {
    const { outcome, titles, profile } = await race({ start: 'Moth Orchard', target: 'Tidewatch Observatory' });
    expect(profile.backlinks).toEqual(new Set(['Copper Lighthouse', 'Moonlit Causeway', 'Spider silk']));
    expect(outcome.found).toBe(true);
    expect(titles[0]).toBe('Moth Orchard');
    expect(titles.at(-1)).toBe('Tidewatch Observatory');
    expect(new Set(titles).size).toBe(titles.length);
    expect(outcome.hops).toBeLessThanOrEqual(4);
    // The last hop is a direct link and the one before comes from a backlink.
    const reasons = outcome.steps.slice(1).map((s) => s.decision?.reason);
    expect(reasons.at(-1)).toBe('target');
    expect(reasons.at(-2)).toBe('backlink');
  });

  it('takes a direct link to the target, even through a redirect', async () => {
    const pages = [page('Start', ['Detour', 'Obs']), page('Detour', []), page('Observatory', []), { title: 'Obs', lead: [], redirectTo: 'Observatory' }];
    const { outcome, titles } = await race({ pages, start: 'Start', target: 'Observatory' });
    expect(titles).toEqual(['Start', 'Observatory']);
    expect(outcome.steps[1].decision?.reason).toBe('target');
  });

  it('prefers a page that links to the target over a more similar one', async () => {
    const pages = [
      page('Start', ['Lighthouse lantern', 'Glass Quarry']),
      page('Lighthouse lantern', ['Start']),
      page('Glass Quarry', ['Observatory']),
      page('Observatory', []),
    ];
    const { titles, outcome } = await race({ pages, start: 'Start', target: 'Observatory' });
    expect(titles).toEqual(['Start', 'Glass Quarry', 'Observatory']);
    expect(outcome.steps[1].decision?.reason).toBe('backlink');
  });

  it('climbs back from a dead end and tries the next best link', async () => {
    const pages = [
      // Without backlink data (none link to the target except via Exit), similarity picks Lantern first.
      page('Start', ['Lantern', 'Exit']),
      page('Lantern', ['Start']),
      page('Exit', ['Bridge']),
      page('Bridge', ['Lighthouse tower']),
      page('Lighthouse tower', []),
    ];
    const lanternFirst: Ranker = {
      async rank(_t, links) {
        const order = ['Lantern', 'Exit', 'Bridge', 'Start'];
        const scored = [...links].sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title)).map((link, i) => ({ link, score: 1 - i / 10 }));
        return { scored, method: 'semantic' };
      },
    };
    const { titles, outcome } = await race({ pages, start: 'Start', target: 'Lighthouse tower', ranker: lanternFirst });
    expect(outcome.found).toBe(true);
    expect(titles).toEqual(['Start', 'Lantern', 'Start', 'Exit', 'Bridge', 'Lighthouse tower']);
    expect(outcome.steps.map((s) => s.via)).toEqual(['start', 'link', 'back', 'link', 'link', 'link']);
  });

  it('skips links to articles that were deleted since the page was rendered', async () => {
    const pages = [page('Start', ['Ghost', 'Exit']), page('Ghost', ['Goal']), page('Exit', ['Goal']), page('Goal', [])];
    const ghostFirst: Ranker = {
      async rank(_t, links) {
        const scored = [...links]
          .sort((a, b) => Number(b.title === 'Ghost') - Number(a.title === 'Ghost'))
          .map((link, i) => ({ link, score: 1 - i / 10 }));
        return { scored, method: 'semantic' };
      },
    };
    const { titles } = await race({
      pages,
      start: 'Start',
      target: 'Goal',
      ranker: ghostFirst,
      // Ghost is still linked in the HTML, but its article is gone.
      fetchFn: (wiki) => async (url, init) => (url.includes('/page/html/Ghost') ? new Response('gone', { status: 404 }) : wiki.fetch(url, init)),
    });
    expect(titles).toEqual(['Start', 'Exit', 'Goal']);
  });

  it('still plays (lexically) when the Action API is down', async () => {
    const pages = [page('Start', ['Banana', 'Observatory tower']), page('Banana', []), page('Observatory tower', ['Observatory']), page('Observatory', [])];
    const { titles, outcome } = await race({
      pages,
      start: 'Start',
      target: 'Observatory',
      ranker: new FallbackRanker(new SemanticRanker({ status: 'failed', load: async () => {}, embed: async () => [] }), new LexicalRanker()),
      fetchFn: (wiki) => async (url, init) => (url.includes('/w/api.php') ? new Response('down', { status: 503 }) : wiki.fetch(url, init)),
    });
    expect(outcome.found).toBe(true);
    expect(titles).toEqual(['Start', 'Observatory tower', 'Observatory']);
    expect(outcome.steps[1].decision?.reason).toBe('lexical');
  });

  it('gives up after too many hops', async () => {
    const chain = Array.from({ length: 10 }, (_, i) => page(`P${i}`, [`P${i + 1}`]));
    const { outcome } = await race({ pages: [...chain, page('P10', []), page('Goal', [])], start: 'P0', target: 'Goal', maxHops: 4, ranker: new LexicalRanker() });
    expect(outcome.found).toBe(false);
    expect(outcome.hops).toBe(4);
  });

  it('reports being stuck when the start page has nowhere to go', async () => {
    const { outcome } = await race({ pages: [page('Island', []), page('Goal', [])], start: 'Island', target: 'Goal', ranker: new LexicalRanker() });
    expect(outcome).toMatchObject({ found: false, hops: 0 });
  });
});

describe('buildCandidates', () => {
  it('resolves redirects, drops red links and keeps the first occurrence', () => {
    const raw = [
      { title: 'USA', text: 'US' },
      { title: 'Atlantis Bay', text: 'bay' },
      { title: 'United States', text: 'the States' },
      { title: 'Mercury', text: 'Mercury' },
      { title: '', text: 'empty' },
    ];
    const resolution = {
      redirects: new Map([['USA', 'United States']]),
      missing: new Set(['Atlantis Bay']),
      existing: new Set(['United States', 'Mercury']),
      disambiguation: new Set(['Mercury']),
      complete: true,
    };
    expect(buildCandidates(raw, resolution)).toEqual([
      { title: 'United States', linkedTitle: 'USA', text: 'US', order: 0, disambiguation: false },
      { title: 'Mercury', linkedTitle: 'Mercury', text: 'Mercury', order: 3, disambiguation: true },
    ]);
    expect(buildCandidates(raw, null).map((c) => c.title)).toEqual(['USA', 'Atlantis Bay', 'United States', 'Mercury']);
  });
});
