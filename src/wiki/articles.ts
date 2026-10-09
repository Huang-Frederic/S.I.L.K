/**
 * Loads articles and keeps their sanitized form in memory, so that a page
 * visited by both the player and the spider is fetched and parsed only once.
 */
import type { WikiClient } from './client';
import { sanitizeArticle, type SanitizedArticle } from './sanitize';
import { normalizeTitle } from './titles';

export interface LoadedArticle {
  /** Canonical title (after redirects). */
  title: string;
  /** Set when the requested title was a redirect to `title`. */
  redirectedFrom: string | null;
  article: SanitizedArticle;
}

export class ArticleStore {
  private readonly byTitle = new Map<string, Promise<LoadedArticle>>();

  constructor(readonly client: WikiClient) {}

  load(title: string, options: { priority?: boolean } = {}): Promise<LoadedArticle> {
    const key = normalizeTitle(title);
    const cached = this.byTitle.get(key);
    if (cached) {
      // Maybe still queued behind the spider's traffic: the player wants it now.
      if (options.priority) this.client.prioritizeArticle(key);
      return cached;
    }

    const promise = this.client.fetchArticle(key, options).then((fetched) => {
      const article = sanitizeArticle(fetched.html, { title: fetched.title, lang: this.client.lang });
      return {
        title: fetched.title,
        redirectedFrom: fetched.title !== key ? key : null,
        article,
      } satisfies LoadedArticle;
    });
    this.byTitle.set(key, promise);
    promise.then(
      // Also remember the article under its canonical title.
      (loaded) => {
        if (!this.byTitle.has(loaded.title)) {
          this.byTitle.set(loaded.title, Promise.resolve({ ...loaded, redirectedFrom: null }));
        }
      },
      () => this.byTitle.delete(key),
    );
    return promise;
  }
}
