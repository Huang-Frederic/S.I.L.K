/**
 * Turns Parsoid HTML from the REST API into a clean, self-contained article
 * fragment that we can style ourselves.
 *
 * The output is rebuilt node by node from an allowlist (tags, attributes and
 * a few classes), so nothing executable or remote (scripts, styles, images,
 * event handlers, ids) survives. Only links to other main-namespace articles
 * in the article body stay clickable; references, navboxes, edit links,
 * external links, red links and self links are turned into plain text.
 */
import type { Lang } from '../i18n';
import { isArticleTitle, normalizeTitle, parseWikiHref } from './titles';

export interface SanitizedArticle {
  /** Canonical title of the article. */
  title: string;
  /** Detached `<div class="wiki-body">` holding the cleaned content. */
  body: HTMLElement;
  /** Number of playable links (main-namespace articles) in the body. */
  linkCount: number;
  isDisambiguation: boolean;
  /** Short description ("Order of arachnids"), when the page has one. */
  description: string;
}

/** Elements dropped together with their content before rebuilding. */
const REMOVED_SELECTORS = [
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'img',
  'picture',
  'svg',
  'video',
  'audio',
  'source',
  'track',
  'map',
  'canvas',
  'figure',
  'figcaption',
  // References and citations
  'sup.reference',
  'sup.mw-ref',
  '.mw-ref',
  '.mw-references-wrap',
  'ol.references',
  '.reflist',
  '.refbegin',
  '.mw-cite-backlink',
  '[typeof~="mw:Extension/references"]',
  // Edit links, navigation boxes, maintenance and meta templates
  '.mw-editsection',
  '.navbox',
  '.navbox-styles',
  '.vertical-navbox',
  '[role="navigation"]',
  '.sidebar',
  '.metadata',
  '.ambox',
  '.tmbox',
  '.ombox',
  '.cmbox',
  '.fmbox',
  '.imbox',
  '.dmbox',
  '.mbox-small',
  '.portalbox',
  // French Wikipedia: portal bar, sister-project box (its banners are .metadata)
  '.bandeau-portail',
  '#bandeau-portail',
  '.autres-projets',
  '.sistersitebox',
  '.side-box',
  '.noprint',
  '.mw-empty-elt',
  '.shortdescription',
  '.authority-control',
  '.catlinks',
  '.mw-indicators',
  '.toc',
  // Maps, coordinates, galleries and other visual-only content
  '#coordinates',
  '.geo-default',
  '.geo-nondefault',
  '.mw-kartographer-maplink',
  '.gallery',
  '.thumb',
  '.clade',
  '[style*="display:none"]',
  '[style*="display: none"]',
].join(',');

/** Sections that are not part of the article body proper (English and French). */
const EXCLUDED_SECTION =
  /^(references?|notes?|citations?|sources?|bibliography|further reading|external links?|footnotes|works cited|notes and references|references and notes|explanatory notes|general references|cited sources|general and cited references|primary sources|secondary sources|reference notes|endnotes|literature|références?|notes et références|références et notes|notes et sources|sources et références|liens? externes?|bibliographie|bibliographie et sources|sources et bibliographie|webographie|ouvrages|ouvrages cités|lectures complémentaires)$/i;

/** Tags copied as-is (minus attributes). Anything else is unwrapped. */
const KEPT_TAGS = new Set([
  'section',
  'div',
  'p',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'hr',
  'br',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'abbr',
  'cite',
  'q',
  'code',
  'kbd',
  'samp',
  'var',
  'bdi',
  'time',
  'mark',
  'wbr',
]);

/** Classes worth keeping for styling (others are dropped). */
const KEPT_CLASSES = new Set(['hatnote', 'infobox', 'wikitable', 'hlist', 'plainlist', 'quotebox', 'sidebar-title']);
/** French Wikipedia's infoboxes (and taxoboxes), styled as infoboxes. */
const INFOBOX_CLASSES = /^(infobox_v2|infobox_v3|taxobox_v3)$/;

const SELF_LINK_CLASSES = /\b(new|mw-selflink|selflink|mw-selflink-fragment)\b/;

export interface SanitizeOptions {
  /** Canonical title of the page (links back to it are disabled). */
  title: string;
  /** Which Wikipedia it comes from (namespaces differ), English by default. */
  lang?: Lang;
  /** Document used to create the output nodes (defaults to the global one). */
  doc?: Document;
}

export function sanitizeArticle(html: string, options: SanitizeOptions): SanitizedArticle {
  const doc = options.doc ?? document;
  const pageTitle = normalizeTitle(options.title);
  const source = new DOMParser().parseFromString(html, 'text/html');

  const isDisambiguation = !!source.querySelector('meta[property="mw:PageProp/disambiguation"]');
  const description = source.querySelector('.shortdescription')?.textContent?.trim() ?? '';

  replaceMath(source);
  removeExcludedSections(source);
  source.querySelectorAll(REMOVED_SELECTORS).forEach((el) => el.remove());

  const body = doc.createElement('div');
  body.className = 'wiki-body';
  const state: BuildState = { doc, pageTitle, lang: options.lang ?? 'en' };
  for (const child of Array.from(source.body.childNodes)) {
    appendClean(child, body, state);
  }
  pruneEmpty(body);
  wrapTables(body, doc);

  return { title: pageTitle, body, linkCount: body.querySelectorAll('a.wiki-link').length, isDisambiguation, description };
}

interface BuildState {
  doc: Document;
  pageTitle: string;
  lang: Lang;
}

/** Recursively copies `node` into `parent`, keeping only allowlisted markup. */
function appendClean(node: Node, parent: Node, state: BuildState): void {
  if (node.nodeType === 3 /* text */) {
    parent.appendChild(state.doc.createTextNode(node.textContent ?? ''));
    return;
  }
  if (node.nodeType !== 1 /* element */) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'a') {
    appendLink(el, parent, state);
    return;
  }

  if (!KEPT_TAGS.has(tag)) {
    // Unknown or presentational wrapper (span, font, center...): keep the content only.
    for (const child of Array.from(el.childNodes)) appendClean(child, parent, state);
    return;
  }

  const out = state.doc.createElement(tag);
  copySafeAttributes(el, out, tag);
  for (const child of Array.from(el.childNodes)) appendClean(child, out, state);
  parent.appendChild(out);
}

function appendLink(el: Element, parent: Node, state: BuildState): void {
  const rel = (el.getAttribute('rel') ?? '').split(/\s+/);
  const href = el.getAttribute('href') ?? '';
  const classes = el.getAttribute('class') ?? '';
  const target = rel.includes('mw:WikiLink') && !SELF_LINK_CLASSES.test(classes) ? parseWikiHref(href) : null;
  const playable = target && isArticleTitle(target.title, state.lang) && target.title !== state.pageTitle;

  if (!playable) {
    for (const child of Array.from(el.childNodes)) appendClean(child, parent, state);
    return;
  }

  const link = state.doc.createElement('a');
  link.className = 'wiki-link';
  link.dataset.title = target.title;
  link.setAttribute('href', `#${encodeURIComponent(target.title)}`);
  link.title = target.title;
  for (const child of Array.from(el.childNodes)) appendClean(child, link, state);
  // Links without visible text (e.g. image links) are useless in a text-only article.
  if (!link.textContent?.trim()) {
    for (const child of Array.from(link.childNodes)) parent.appendChild(child);
    return;
  }
  parent.appendChild(link);
}

function copySafeAttributes(from: Element, to: HTMLElement, tag: string): void {
  if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const value = Number(from.getAttribute(name));
      if (Number.isInteger(value) && value > 1 && value <= 50) to.setAttribute(name, String(value));
    }
  }
  if (tag === 'ol') {
    const start = Number(from.getAttribute('start'));
    if (Number.isInteger(start)) to.setAttribute('start', String(start));
  }
  if (tag === 'abbr') {
    const title = from.getAttribute('title');
    if (title) to.title = title;
  }
  const classes = (from.getAttribute('class') ?? '')
    .split(/\s+/)
    .map((c) => (INFOBOX_CLASSES.test(c) ? 'infobox' : c))
    .filter((c) => KEPT_CLASSES.has(c) || /^infobox-(above|header|label|data|subheader|title)$/.test(c));
  if (classes.length) to.className = [...new Set(classes)].map((c) => `wiki-${c}`).join(' ');
}

/** Replaces MathML/fallback-image formulas with their TeX source as inline code. */
function replaceMath(source: Document): void {
  source.querySelectorAll('.mwe-math-element').forEach((el) => {
    const tex =
      el.querySelector('math')?.getAttribute('alttext') ?? el.querySelector('img')?.getAttribute('alt') ?? '';
    const code = source.createElement('code');
    code.textContent = tex.replace(/^\{\\(?:display|text)style\s*/, '').replace(/\}$/, '').trim();
    el.replaceWith(code);
  });
}

/** Drops "References", "External links"... sections, which Parsoid wraps in <section>. */
function removeExcludedSections(source: Document): void {
  source.querySelectorAll('section').forEach((section) => {
    const heading = section.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > div > h2, :scope > div > h3');
    const text = heading?.textContent?.trim() ?? '';
    if (text && EXCLUDED_SECTION.test(text)) section.remove();
  });
}

const ALWAYS_KEEP = new Set(['br', 'hr', 'td', 'th']);

/** Removes elements left empty once images, references and templates are gone. */
function pruneEmpty(root: HTMLElement): void {
  // Children first, so that emptiness bubbles up to the containers.
  const all = Array.from(root.querySelectorAll('*')).reverse();
  for (const el of all) {
    if (ALWAYS_KEEP.has(el.tagName.toLowerCase())) continue;
    if (!el.textContent?.trim()) el.remove();
  }
  // A section reduced to its heading has nothing left to read (innermost first).
  const sections = Array.from(root.querySelectorAll('section')).reverse();
  for (const section of sections) {
    const heading = section.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
    if (!heading) continue;
    const rest = (section.textContent ?? '').replace(heading.textContent ?? '', '');
    if (!rest.trim()) section.remove();
  }
}

/** Wraps wide tables so that they scroll horizontally instead of overflowing. */
function wrapTables(root: HTMLElement, doc: Document): void {
  root.querySelectorAll('table').forEach((table) => {
    if (table.classList.contains('wiki-infobox') || table.parentElement?.closest('table, .wiki-infobox')) return;
    const wrap = doc.createElement('div');
    wrap.className = 'wiki-table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
}
