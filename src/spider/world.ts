/**
 * Bridges Wikipedia and the spider's pure AI: turns an article into the list
 * of candidate links the brain chooses from, and builds the target profile.
 */
import type { ArticleStore, LoadedArticle } from '../wiki/articles';
import type { LinkResolution, PageInfo, WikiClient } from '../wiki/client';
import type { PageLoader, SpiderPage } from './ai/agent';
import type { CandidateLink, TargetProfile } from './ai/types';

/** A page as the spider sees it: candidate links plus the article to render. */
export interface SpiderArticlePage extends SpiderPage {
  loaded: LoadedArticle;
}

export interface RawLink {
  /** Normalized title from the link's href. */
  title: string;
  text: string;
}

/** Playable links of a sanitized article body, in reading order. */
export function linksOfBody(body: ParentNode): RawLink[] {
  return Array.from(body.querySelectorAll<HTMLAnchorElement>('a.wiki-link')).map((a) => ({
    title: a.dataset.title ?? '',
    text: (a.textContent ?? '').trim(),
  }));
}

/**
 * One candidate per destination, in reading order. Redirects are resolved and
 * red links dropped when the Action API answered; otherwise titles are used
 * as written.
 */
export function buildCandidates(links: readonly RawLink[], resolution: LinkResolution | null): CandidateLink[] {
  const seen = new Set<string>();
  const out: CandidateLink[] = [];
  links.forEach((raw, order) => {
    if (!raw.title) return;
    const title = resolution?.redirects.get(raw.title) ?? raw.title;
    if (resolution?.missing.has(title) || seen.has(title)) return;
    seen.add(title);
    out.push({
      title,
      linkedTitle: raw.title,
      text: raw.text,
      order,
      disambiguation: resolution?.disambiguation.has(title) ?? false,
    });
  });
  return out;
}

/** Page loader used in the game: article (shared cache) + link resolution. */
export function createPageLoader(store: ArticleStore, client: WikiClient): PageLoader<SpiderArticlePage> {
  return async (title: string) => {
    const loaded = await store.load(title);
    let resolution: LinkResolution | null = null;
    try {
      resolution = await client.fetchLinkResolution(loaded.title);
    } catch {
      // The spider can still play with unresolved titles.
    }
    return { title: loaded.title, loaded, links: buildCandidates(linksOfBody(loaded.article.body), resolution) };
  };
}

/** Gathers what the spider knows about the target before the race. */
export async function buildTargetProfile(client: WikiClient, target: PageInfo): Promise<TargetProfile> {
  let backlinks: ReadonlySet<string> = new Set();
  let aliases: ReadonlySet<string> = new Set();
  try {
    const result = await client.fetchBacklinks(target.title);
    backlinks = result.linking;
    aliases = result.aliases;
  } catch {
    // Without backlinks the spider relies on similarity alone.
  }
  const summary = [target.description, target.extract].filter(Boolean).join('. ');
  return { title: target.title, aliases, summary, backlinks };
}
