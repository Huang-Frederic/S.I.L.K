import { describe, expect, it } from 'vitest';
import { pickRandomTarget, TARGET_POOLS, validatePair } from '../src/game/pairs';
import { ArticleNotFoundError, canonicalTitleFromHtml, WikiClient } from '../src/wiki/client';
import { HttpQueue } from '../src/wiki/http';
import { demoPages } from './helpers/demoWorld';
import { FakeWiki } from './helpers/fakeWiki';

function setup(batchSize?: number) {
  const wiki = new FakeWiki(demoPages(), { batchSize });
  const client = new WikiClient({ http: new HttpQueue({ fetchFn: wiki.fetch, sleep: async () => {} }) });
  return { wiki, client };
}

describe('WikiClient', () => {
  it('fetches article HTML and resolves redirects to the canonical title', async () => {
    const { client } = setup();
    const direct = await client.fetchArticle('Loomhaven');
    expect(direct.title).toBe('Loomhaven');
    const redirected = await client.fetchArticle('Loom Haven');
    expect(redirected.title).toBe('Loomhaven');
    expect(redirected.requestedTitle).toBe('Loom Haven');
    expect(redirected.html).toContain('<title>Loomhaven</title>');
  });

  it('reports missing articles', async () => {
    const { client } = setup();
    await expect(client.fetchArticle('Sunken Library')).rejects.toBeInstanceOf(ArticleNotFoundError);
  });

  it('resolves links (redirects, red links, disambiguations) across continuation batches', async () => {
    const { client, wiki } = setup(2);
    const links = await client.fetchLinkResolution('Loomhaven');
    expect(links.complete).toBe(true);
    expect(links.missing).toEqual(new Set(['Sunken Library', 'Reference Only Page']));
    expect(links.existing.has('Weavers Guild')).toBe(true);
    expect(wiki.requests.filter((u) => u.includes('generator=links')).length).toBe(4);

    const old = await client.fetchLinkResolution('Old Archive');
    expect(old.disambiguation).toEqual(new Set(['Lighthouse']));
  });

  it('collects backlinks, including links through redirects', async () => {
    const { client } = setup();
    const backlinks = await client.fetchBacklinks('Tidewatch Observatory');
    expect(backlinks.aliases).toEqual(new Set(['Observatory of Tidewatch']));
    expect([...backlinks.linking].sort()).toEqual(['Copper Lighthouse', 'Moonlit Causeway', 'Spider silk']);
  });

  it('returns page info keyed by the requested title', async () => {
    const { client } = setup();
    const info = await client.fetchPageInfo(['Loom Haven', 'Lighthouse', 'Nowhere']);
    expect(info.get('Loom Haven')).toMatchObject({ title: 'Loomhaven', exists: true, disambiguation: false });
    expect(info.get('Loom Haven')!.extract).toContain('Loomhaven');
    expect(info.get('Lighthouse')).toMatchObject({ exists: true, disambiguation: true });
    expect(info.get('Nowhere')).toMatchObject({ exists: false });
  });

  it('searches titles by prefix', async () => {
    const { client } = setup();
    expect(await client.searchTitles('moo')).toEqual(['Moonlit Causeway']);
    expect(await client.searchTitles('  ')).toEqual([]);
  });
});

describe('canonicalTitleFromHtml', () => {
  it('prefers dc:isVersionOf, then <title>', () => {
    expect(canonicalTitleFromHtml('<head><link rel="dc:isVersionOf" href="//en.wikipedia.org/wiki/C%2B%2B"/><title>x</title></head>')).toBe('C++');
    expect(canonicalTitleFromHtml('<head><title>Tom &amp; Jerry</title></head>')).toBe('Tom & Jerry');
    expect(canonicalTitleFromHtml('<p>no head</p>')).toBeNull();
  });
});

describe('validatePair', () => {
  it('accepts two distinct articles, resolving redirects', async () => {
    const { client } = setup();
    const result = await validatePair(client, 'loom Haven', 'Observatory of Tidewatch');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pair.start.title).toBe('Loomhaven');
      expect(result.pair.target.title).toBe('Tidewatch Observatory');
    }
  });

  it('rejects missing articles, disambiguation pages and identical pairs', async () => {
    const { client } = setup();
    const missing = await validatePair(client, 'Nowhere', 'Lighthouse');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.start).toMatch(/No English Wikipedia article/);
      expect(missing.errors.target).toMatch(/disambiguation/);
    }
    const same = await validatePair(client, 'Loom Haven', 'Loomhaven');
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.target).toMatch(/different/);
    const empty = await validatePair(client, '', '');
    expect(empty.ok).toBe(false);
  });
  it('answers in French for French Wikipedia', async () => {
    const wiki = new FakeWiki(demoPages());
    const client = new WikiClient({ lang: 'fr', http: new HttpQueue({ fetchFn: wiki.fetch, sleep: async () => {} }) });
    const missing = await validatePair(client, 'Nulle part', 'Lighthouse');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.start).toBe('Aucun article de Wikipédia en français ne s’appelle « Nulle part ».');
      expect(missing.errors.target).toMatch(/page d’homonymie/);
    }
    const empty = await validatePair(client, '', 'Loomhaven');
    if (!empty.ok) expect(empty.errors.start).toBe('Choisis un article de départ.');
  });
});

describe('WikiClient languages', () => {
  it('talks to the Wikipedia of its language', async () => {
    const wiki = new FakeWiki(demoPages());
    const fr = new WikiClient({ lang: 'fr', http: new HttpQueue({ fetchFn: wiki.fetch, sleep: async () => {} }) });
    await fr.fetchArticle('Loomhaven');
    await fr.fetchBacklinks('Loomhaven');
    expect(wiki.requests.length).toBeGreaterThan(1);
    expect(wiki.requests.every((url) => url.startsWith('https://fr.wikipedia.org/'))).toBe(true);
    expect(new WikiClient().lang).toBe('en');
  });

  it('says in French that an article does not exist', async () => {
    const wiki = new FakeWiki(demoPages());
    const fr = new WikiClient({ lang: 'fr', http: new HttpQueue({ fetchFn: wiki.fetch, sleep: async () => {} }) });
    await expect(fr.fetchArticle('Sunken Library')).rejects.toThrow('L’article « Sunken Library » n’existe pas sur Wikipédia en français.');
  });
});

describe('random targets', () => {
  it('come from the pool of the race’s Wikipedia', () => {
    for (let i = 0; i < 20; i++) {
      expect(TARGET_POOLS.fr).toContain(pickRandomTarget('fr', [], () => i / 20));
      expect(TARGET_POOLS.en).toContain(pickRandomTarget('en', [], () => i / 20));
    }
    expect(pickRandomTarget('fr', ['Lune'], () => 0)).not.toBe('Lune');
    expect(new Set(TARGET_POOLS.fr).size).toBe(TARGET_POOLS.fr.length);
    expect(TARGET_POOLS.fr.length).toBeGreaterThan(150);
  });
});
