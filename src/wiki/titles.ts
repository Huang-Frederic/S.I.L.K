/**
 * Helpers for MediaWiki page titles.
 *
 * Titles travel through the game in their "display" form ("Albert Einstein"):
 * spaces instead of underscores and an upper-cased first letter, which is how
 * English Wikipedia normalizes them. Comparing normalized titles lets us match
 * links, API results and the target reliably.
 */

/**
 * Namespace prefixes (and their aliases) on English Wikipedia that are NOT the
 * main/article namespace. Lower-cased for case-insensitive comparison.
 */
const NON_ARTICLE_NAMESPACES = new Set([
  'talk',
  'user',
  'user talk',
  'wikipedia',
  'wikipedia talk',
  'wp',
  'wt',
  'project',
  'project talk',
  'file',
  'file talk',
  'image',
  'image talk',
  'media',
  'mediawiki',
  'mediawiki talk',
  'template',
  'template talk',
  'help',
  'help talk',
  'category',
  'category talk',
  'portal',
  'portal talk',
  'draft',
  'draft talk',
  'timedtext',
  'timedtext talk',
  'module',
  'module talk',
  'special',
  'book',
  'book talk',
  'education program',
  'education program talk',
  'gadget',
  'gadget talk',
  'gadget definition',
  'gadget definition talk',
  'event',
  'event talk',
  'topic',
]);

/** Normalizes a title the way MediaWiki does for English Wikipedia. */
export function normalizeTitle(raw: string): string {
  const t = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // Upper-case the first code point only (MediaWiki's $wgCapitalLinks).
  const first = String.fromCodePoint(t.codePointAt(0)!);
  return first.toUpperCase() + t.slice(first.length);
}

/** True when the title belongs to the main (article) namespace. */
export function isArticleTitle(title: string): boolean {
  const colon = title.indexOf(':');
  if (colon > 0) {
    const prefix = title.slice(0, colon).trim().toLowerCase();
    if (NON_ARTICLE_NAMESPACES.has(prefix)) return false;
  }
  return title.length > 0;
}

export interface ParsedHref {
  title: string;
  fragment: string | null;
}

/**
 * Parses a Parsoid wiki-link href ("./Albert_Einstein#Early_life") into a
 * normalized title. Returns null for anything that is not a plain page link,
 * e.g. red links ("./Foo?action=edit&redlink=1") or absolute URLs.
 */
export function parseWikiHref(href: string): ParsedHref | null {
  if (!href.startsWith('./')) return null;
  let path = href.slice(2);
  if (path.includes('?')) return null;
  let fragment: string | null = null;
  const hash = path.indexOf('#');
  if (hash >= 0) {
    fragment = path.slice(hash + 1);
    path = path.slice(0, hash);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const title = normalizeTitle(decoded);
  return title ? { title, fragment } : null;
}

/** Encodes a title for use as a URL path segment ("AC/DC" -> "AC%2FDC"). */
export function titleToPathSegment(title: string): string {
  return encodeURIComponent(normalizeTitle(title).replace(/ /g, '_'));
}

/** Public URL of an article on English Wikipedia. */
export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${titleToPathSegment(title)}`;
}

/**
 * Extracts the page title from a REST URL such as
 * ".../api/rest_v1/page/html/United_States" or, after the REST layer's 307
 * redirect, ".../w/rest.php/v1/page/United_States/html?redirect=no".
 */
export function titleFromRestUrl(url: string): string | null {
  const match = /\/page\/(?:html\/)?([^/?#]+)(?:\/html)?(?:[?#]|$)/.exec(url);
  if (!match) return null;
  try {
    return normalizeTitle(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/** Compact key for title comparisons that should ignore case and punctuation. */
export function looseTitleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
