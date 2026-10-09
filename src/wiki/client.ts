/**
 * Typed access to the Wikipedia endpoints the game needs:
 *  - REST API for article HTML (Parsoid output),
 *  - Action API (with origin=* for anonymous CORS) for links, backlinks,
 *    page info, random pages and opensearch autocomplete.
 */
import { API_USER_AGENT, MAX_CONCURRENT_REQUESTS, WIKI_ACTION_API, WIKI_REST_BASE } from '../config';
import { HttpError, HttpQueue } from './http';
import { normalizeTitle, titleFromRestUrl, titleToPathSegment } from './titles';

export class ArticleNotFoundError extends Error {
  constructor(readonly title: string) {
    super(`The article “${title}” does not exist on English Wikipedia.`);
    this.name = 'ArticleNotFoundError';
  }
}

export interface ArticleHtml {
  /** Canonical title after following redirects. */
  title: string;
  /** Title that was asked for (differs from `title` after a redirect). */
  requestedTitle: string;
  html: string;
}

/** How the links of a page resolve (from the Action API). */
export interface LinkResolution {
  /** Redirect title -> canonical target title. */
  redirects: Map<string, string>;
  /** Link targets that do not exist (red links). */
  missing: Set<string>;
  /** Canonical titles of existing link targets. */
  existing: Set<string>;
  /** Canonical titles of link targets that are disambiguation pages. */
  disambiguation: Set<string>;
  /** False when the page had more links than we were willing to page through. */
  complete: boolean;
}

export interface Backlinks {
  /** Article titles that link to the target (directly or through a redirect). */
  linking: Set<string>;
  /** Redirect titles that point to the target. */
  aliases: Set<string>;
}

export interface PageInfo {
  requested: string;
  /** Canonical title (after normalization and redirects). */
  title: string;
  exists: boolean;
  disambiguation: boolean;
  /** Plain-text intro (a few sentences). */
  extract: string;
  /** Wikidata/short description, if any. */
  description: string;
  /** Size of the wikitext in bytes. */
  length: number;
}

export interface RandomArticle {
  title: string;
  length: number;
  disambiguation: boolean;
}

// Minimal shapes of the Action API responses we read (formatversion=2).
interface ApiPage {
  title: string;
  index?: number;
  ns?: number;
  missing?: boolean;
  invalid?: boolean;
  length?: number;
  extract?: string;
  description?: string;
  pageprops?: Record<string, string>;
}
interface ApiQueryResponse {
  continue?: Record<string, string>;
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: ApiPage[];
    backlinks?: Array<{ title: string; redirect?: boolean; redirlinks?: Array<{ title: string }> }>;
  };
}

export interface WikiClientOptions {
  http?: HttpQueue;
  restBase?: string;
  actionApi?: string;
}

export class WikiClient {
  readonly http: HttpQueue;
  private readonly restBase: string;
  private readonly actionApi: string;

  constructor(options: WikiClientOptions = {}) {
    this.http =
      options.http ??
      new HttpQueue({
        maxConcurrent: MAX_CONCURRENT_REQUESTS,
        headers: { 'Api-User-Agent': API_USER_AGENT },
      });
    this.restBase = options.restBase ?? WIKI_REST_BASE;
    this.actionApi = options.actionApi ?? WIKI_ACTION_API;
  }

  private apiUrl(params: Record<string, string>): string {
    const query = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    return `${this.actionApi}?${query.toString()}`;
  }

  /**
   * Fetches the Parsoid HTML of an article. The REST layer answers redirect
   * titles with a 307 to the target, which fetch follows; the final URL (or
   * the document head) tells us the canonical title.
   */
  async fetchArticle(title: string, options: { priority?: boolean } = {}): Promise<ArticleHtml> {
    const requestedTitle = normalizeTitle(title);
    const url = `${this.restBase}/page/html/${titleToPathSegment(requestedTitle)}`;
    let response;
    try {
      response = await this.http.getText(url, { priority: options.priority });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw new ArticleNotFoundError(requestedTitle);
      throw error;
    }
    const canonical =
      canonicalTitleFromHtml(response.text) ??
      (response.url !== url ? titleFromRestUrl(response.url) : null) ??
      requestedTitle;
    return { title: canonical, requestedTitle, html: response.text };
  }

  /** Gives a queued article request the player's priority (the player is about to open it). */
  prioritizeArticle(title: string): void {
    this.http.promote(`${this.restBase}/page/html/${titleToPathSegment(normalizeTitle(title))}`);
  }

  /** Resolves every main-namespace link of a page (redirects, red links, disambiguations). */
  async fetchLinkResolution(title: string, maxBatches = 4): Promise<LinkResolution> {
    const result: LinkResolution = {
      redirects: new Map(),
      missing: new Set(),
      existing: new Set(),
      disambiguation: new Set(),
      complete: true,
    };
    let cont: Record<string, string> = {};
    for (let batch = 0; batch < maxBatches; batch++) {
      const data = await this.http.getJson<ApiQueryResponse>(
        this.apiUrl({
          action: 'query',
          titles: title,
          generator: 'links',
          gplnamespace: '0',
          gpllimit: 'max',
          redirects: '1',
          prop: 'pageprops',
          ppprop: 'disambiguation',
          ...cont,
        }),
      );
      for (const r of data.query?.redirects ?? []) result.redirects.set(r.from, r.to);
      for (const page of data.query?.pages ?? []) {
        if (page.missing || page.invalid) result.missing.add(page.title);
        else result.existing.add(page.title);
        if (page.pageprops && 'disambiguation' in page.pageprops) result.disambiguation.add(page.title);
      }
      if (!data.continue) return result;
      cont = data.continue;
    }
    result.complete = false;
    return result;
  }

  /**
   * Pages linking to `title`, including pages that link through a redirect
   * (blredirect=1). Large targets have huge backlink sets, so we stop after a
   * few batches: the set is a heuristic, not an oracle.
   */
  async fetchBacklinks(title: string, maxBatches = 4): Promise<Backlinks> {
    const linking = new Set<string>();
    const aliases = new Set<string>();
    let cont: Record<string, string> = {};
    for (let batch = 0; batch < maxBatches; batch++) {
      const data = await this.http.getJson<ApiQueryResponse>(
        this.apiUrl({
          action: 'query',
          list: 'backlinks',
          bltitle: title,
          blnamespace: '0',
          bllimit: 'max',
          blredirect: '1',
          ...cont,
        }),
      );
      for (const link of data.query?.backlinks ?? []) {
        if (link.redirect) {
          aliases.add(link.title);
          for (const via of link.redirlinks ?? []) linking.add(via.title);
        } else {
          linking.add(link.title);
        }
      }
      if (!data.continue) break;
      cont = data.continue;
    }
    return { linking, aliases };
  }

  /** Existence, redirects, disambiguation status and intro text for up to 20 titles. */
  async fetchPageInfo(titles: string[]): Promise<Map<string, PageInfo>> {
    const requested = titles.map(normalizeTitle).filter(Boolean);
    const data = await this.http.getJson<ApiQueryResponse>(
      this.apiUrl({
        action: 'query',
        titles: requested.join('|'),
        redirects: '1',
        prop: 'extracts|pageprops|description|info',
        exintro: '1',
        explaintext: '1',
        exsentences: '3',
        exlimit: 'max',
        ppprop: 'disambiguation',
      }),
    );
    const normalized = new Map((data.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const redirects = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
    const pages = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));

    const result = new Map<string, PageInfo>();
    for (const title of requested) {
      let canonical = normalized.get(title) ?? title;
      canonical = redirects.get(canonical) ?? canonical;
      const page = pages.get(canonical);
      result.set(title, {
        requested: title,
        title: canonical,
        exists: !!page && !page.missing && !page.invalid,
        disambiguation: !!page?.pageprops && 'disambiguation' in page.pageprops,
        extract: page?.extract?.trim() ?? '',
        description: page?.description ?? '',
        length: page?.length ?? 0,
      });
    }
    return result;
  }

  /** Title suggestions for the autocomplete (opensearch, redirects resolved). */
  async searchTitles(prefix: string, limit = 8): Promise<string[]> {
    const trimmed = prefix.trim();
    if (!trimmed) return [];
    const data = await this.http.getJson<[string, string[]]>(
      this.apiUrl({
        action: 'opensearch',
        search: trimmed,
        limit: String(limit),
        namespace: '0',
        redirects: 'resolve',
      }),
      { maxRetries: 0 }, // a stale suggestion is not worth waiting for
    );
    return Array.isArray(data?.[1]) ? data[1] : [];
  }

  /** Title suggestions with their short descriptions (autocomplete). */
  async searchPages(prefix: string, limit = 6): Promise<Array<{ title: string; description: string }>> {
    const trimmed = prefix.trim();
    if (!trimmed) return [];
    const data = await this.http.getJson<ApiQueryResponse>(
      this.apiUrl({
        action: 'query',
        generator: 'prefixsearch',
        gpssearch: trimmed,
        gpslimit: String(limit),
        gpsnamespace: '0',
        prop: 'description',
        redirects: '1',
      }),
      { maxRetries: 0 }, // a stale suggestion is not worth waiting for
    );
    const seen = new Set<string>();
    return (data.query?.pages ?? [])
      .filter((p) => !p.missing && !p.invalid)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .filter((p) => !seen.has(p.title) && seen.add(p.title))
      .map((p) => ({ title: p.title, description: p.description ?? '' }));
  }

  /** A handful of random articles with their size (never cached). */
  async fetchRandomArticles(count = 12): Promise<RandomArticle[]> {
    const data = await this.http.getJson<ApiQueryResponse>(
      this.apiUrl({
        action: 'query',
        generator: 'random',
        grnnamespace: '0',
        grnlimit: String(count),
        prop: 'info|pageprops',
        ppprop: 'disambiguation',
      }),
      { noCache: true, maxRetries: 1 },
    );
    return (data.query?.pages ?? []).map((p) => ({
      title: p.title,
      length: p.length ?? 0,
      disambiguation: !!p.pageprops && 'disambiguation' in p.pageprops,
    }));
  }
}

/** Reads the canonical title from a Parsoid document head. */
export function canonicalTitleFromHtml(html: string): string | null {
  // <link rel="dc:isVersionOf" href="//en.wikipedia.org/wiki/Spider"/>
  const head = html.slice(0, 6000);
  const link = /<link[^>]+rel="dc:isVersionOf"[^>]+href="[^"]*\/wiki\/([^"#?]+)"/.exec(head);
  if (link) {
    try {
      return normalizeTitle(decodeURIComponent(link[1]));
    } catch {
      // fall through to <title>
    }
  }
  const title = /<title>([^<]*)<\/title>/.exec(head);
  return title ? normalizeTitle(decodeHtmlEntities(title[1])) : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
