/**
 * A tiny in-memory Wikipedia used by the tests (and handy for local end-to-end
 * runs). It answers the same endpoints the game uses:
 *  - REST    /api/rest_v1/page/html/{title}   (Parsoid-like HTML)
 *  - Action  /w/api.php  opensearch, generator=links, list=backlinks,
 *                        page info (extracts/pageprops/description/info),
 *                        generator=random
 *
 * Page text uses a mini wikitext: "[[Target]]" or "[[Target|label]]".
 * Only erasable TypeScript syntax is used so Node can run it directly.
 */

export interface FakePage {
  title: string;
  /** Lead paragraphs. */
  lead: string[];
  sections?: Array<{ heading: string; paragraphs: string[] }>;
  /** Links that only appear in references / navboxes (must not be playable). */
  hiddenLinks?: string[];
  /** Makes this title a redirect to another page. */
  redirectTo?: string;
  disambiguation?: boolean;
  description?: string;
}

export interface FakeWikiOptions {
  /** Max items per Action API batch (small values exercise continuation). */
  batchSize?: number;
}

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function normalize(title: string): string {
  const t = title.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hrefFor(title: string): string {
  return './' + encodeURIComponent(normalize(title).replace(/ /g, '_'));
}

export class FakeWiki {
  readonly pages = new Map<string, FakePage>();
  readonly requests: string[] = [];
  private readonly batchSize: number;

  constructor(pages: FakePage[], options: FakeWikiOptions = {}) {
    for (const page of pages) this.pages.set(normalize(page.title), { ...page, title: normalize(page.title) });
    this.batchSize = options.batchSize ?? 500;
  }

  /** Follows a redirect title to its target (one level, like MediaWiki). */
  resolve(title: string): string {
    const page = this.pages.get(normalize(title));
    return page?.redirectTo ? normalize(page.redirectTo) : normalize(title);
  }

  exists(title: string): boolean {
    return this.pages.has(this.resolve(title));
  }

  /** Raw link targets of a page (as written, including hidden ones), deduplicated. */
  rawLinks(title: string): string[] {
    const page = this.pages.get(normalize(title));
    if (!page) return [];
    const texts = [...page.lead, ...(page.sections ?? []).flatMap((s) => s.paragraphs)];
    const out: string[] = [];
    for (const text of texts) for (const m of text.matchAll(LINK)) out.push(normalize(m[1]));
    for (const hidden of page.hiddenLinks ?? []) out.push(normalize(hidden));
    return [...new Set(out)];
  }

  /** Renders the Parsoid-like HTML document of a (non-redirect) page. */
  html(title: string): string {
    const page = this.pages.get(normalize(title))!;
    const renderText = (text: string) => {
      let html = '';
      let last = 0;
      for (const m of text.matchAll(LINK)) {
        html += escapeHtml(text.slice(last, m.index));
        const target = normalize(m[1]);
        const label = m[2] ?? m[1];
        const cls = this.exists(target) ? (this.pages.get(target)?.redirectTo ? ' class="mw-redirect"' : '') : ' class="new"';
        const href = this.exists(target) ? hrefFor(target) : `${hrefFor(target)}?action=edit&amp;redlink=1`;
        html += `<a rel="mw:WikiLink" href="${href}" title="${escapeHtml(target)}"${cls}>${escapeHtml(label)}</a>`;
        last = (m.index ?? 0) + m[0].length;
      }
      return html + escapeHtml(text.slice(last));
    };
    const para = (text: string) => `<p>${renderText(text)}</p>`;
    const sections = (page.sections ?? [])
      .map((s, i) => `<section data-mw-section-id="${i + 1}"><h2 id="s${i}">${escapeHtml(s.heading)}</h2>${s.paragraphs.map(para).join('')}</section>`)
      .join('');
    const hidden = (page.hiddenLinks ?? [])
      .map((t) => `<a rel="mw:WikiLink" href="${hrefFor(t)}" title="${escapeHtml(t)}">${escapeHtml(t)}</a>`)
      .join(' ');
    const disambig = page.disambiguation ? '<meta property="mw:PageProp/disambiguation"/>' : '';
    const shortdesc = page.description
      ? `<div class="shortdescription nomobile noexcerpt noprint searchaux" style="display:none">${escapeHtml(page.description)}</div>`
      : '';
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
      `<link rel="dc:isVersionOf" href="//en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}"/>` +
      `<title>${escapeHtml(page.title)}</title></head><body>` +
      `<section data-mw-section-id="0">${shortdesc}${disambig}` +
      `<p><span typeof="mw:Transclusion"></span></p>` +
      `${page.lead.map(para).join('')}</section>${sections}` +
      `<section data-mw-section-id="90"><h2 id="References">References</h2><div class="mw-references-wrap"><ol class="references"><li>${hidden}</li></ol></div></section>` +
      `<div role="navigation" class="navbox">${hidden}</div>` +
      '</body></html>'
    );
  }

  /** Plain-text extract (first lead paragraph without link markup). */
  extract(title: string): string {
    const page = this.pages.get(normalize(title));
    return (page?.lead[0] ?? '').replace(LINK, (_m, target: string, label?: string) => label ?? target);
  }

  /** A fetch-compatible handler. */
  fetch = async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    this.requests.push(url.href);
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

    const rest = /\/api\/rest_v1\/page\/html\/([^/?#]+)/.exec(url.pathname);
    if (rest) {
      const requested = normalize(decodeURIComponent(rest[1]));
      if (!this.exists(requested)) return new Response('Not found', { status: 404 });
      return new Response(this.html(this.resolve(requested)), { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (url.pathname.endsWith('/w/api.php')) {
      const p = url.searchParams;
      if (p.get('action') === 'opensearch') {
        const q = (p.get('search') ?? '').toLowerCase();
        const limit = Number(p.get('limit') ?? 10);
        const titles = [...this.pages.values()]
          .filter((page) => !page.redirectTo && page.title.toLowerCase().startsWith(q))
          .map((page) => page.title)
          .slice(0, limit);
        return json([p.get('search'), titles, [], []]);
      }
      if (p.get('generator') === 'links') return json(this.linksResponse(p));
      if (p.get('list') === 'backlinks') return json(this.backlinksResponse(p));
      if (p.get('generator') === 'random') return json(this.randomResponse(Number(p.get('grnlimit') ?? 10)));
      if (p.get('titles')) return json(this.infoResponse(p.get('titles')!.split('|')));
    }
    return new Response('Unknown endpoint', { status: 400 });
  };

  private linksResponse(p: URLSearchParams) {
    const all = this.rawLinks(p.get('titles') ?? '');
    const offset = Number(p.get('gplcontinue') ?? 0);
    const batch = all.slice(offset, offset + this.batchSize);
    const redirects = batch.filter((t) => this.pages.get(t)?.redirectTo).map((t) => ({ from: t, to: this.resolve(t) }));
    const targets = [...new Set(batch.map((t) => this.resolve(t)))];
    const pages = targets.map((t) => {
      const page = this.pages.get(t);
      if (!page) return { ns: 0, title: t, missing: true };
      return { pageid: 1, ns: 0, title: t, ...(page.disambiguation ? { pageprops: { disambiguation: '' } } : {}) };
    });
    const more = offset + this.batchSize < all.length;
    return {
      batchcomplete: !more,
      ...(more ? { continue: { gplcontinue: String(offset + this.batchSize), continue: 'gplcontinue||' } } : {}),
      query: { ...(redirects.length ? { redirects } : {}), pages },
    };
  }

  private backlinksResponse(p: URLSearchParams) {
    const target = this.resolve(p.get('bltitle') ?? '');
    const linkers = (to: string) =>
      [...this.pages.values()].filter((page) => !page.redirectTo && this.rawLinks(page.title).includes(to)).map((page) => page.title);
    const entries: Array<{ pageid: number; ns: number; title: string; redirect?: boolean; redirlinks?: Array<{ pageid: number; ns: number; title: string }> }> = [];
    for (const title of linkers(target)) entries.push({ pageid: 1, ns: 0, title });
    for (const page of this.pages.values()) {
      if (page.redirectTo && normalize(page.redirectTo) === target) {
        entries.push({ pageid: 1, ns: 0, title: page.title, redirect: true, redirlinks: linkers(page.title).map((title) => ({ pageid: 1, ns: 0, title })) });
      }
    }
    const offset = Number(p.get('blcontinue') ?? 0);
    const batch = entries.slice(offset, offset + this.batchSize);
    const more = offset + this.batchSize < entries.length;
    return {
      ...(more ? { continue: { blcontinue: String(offset + this.batchSize), continue: '-||' } } : {}),
      query: { backlinks: batch },
    };
  }

  private infoResponse(titles: string[]) {
    const redirects: Array<{ from: string; to: string }> = [];
    const pages = [];
    for (const raw of titles) {
      const title = normalize(raw);
      const page = this.pages.get(title);
      if (page?.redirectTo) redirects.push({ from: title, to: this.resolve(title) });
      const canonical = this.resolve(title);
      const target = this.pages.get(canonical);
      if (!target) {
        pages.push({ ns: 0, title: canonical, missing: true });
        continue;
      }
      pages.push({
        pageid: 1,
        ns: 0,
        title: canonical,
        length: 1000 + this.extract(canonical).length * 20,
        extract: this.extract(canonical),
        ...(target.description ? { description: target.description } : {}),
        ...(target.disambiguation ? { pageprops: { disambiguation: '' } } : {}),
      });
    }
    return { batchcomplete: true, query: { ...(redirects.length ? { redirects } : {}), pages } };
  }

  private randomResponse(count: number) {
    const pages = [...this.pages.values()].filter((p) => !p.redirectTo).slice(0, count);
    return {
      query: {
        pages: pages.map((p) => ({
          pageid: 1,
          ns: 0,
          title: p.title,
          length: 9000,
          ...(p.disambiguation ? { pageprops: { disambiguation: '' } } : {}),
        })),
      },
    };
  }
}
