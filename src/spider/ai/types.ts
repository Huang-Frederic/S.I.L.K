/**
 * Types shared by the spider's decision logic. The AI layer is pure: it never
 * touches the DOM or the network directly, so it can be unit tested with
 * plain data and a mocked Wikipedia.
 */

/** A link the spider could follow from its current page. */
export interface CandidateLink {
  /** Canonical title of the linked article (redirects resolved when known). */
  title: string;
  /** Title as written in the article, before redirect resolution. */
  linkedTitle: string;
  /** Visible anchor text of the first occurrence. */
  text: string;
  /** Position of the first occurrence among the page's links (reading order). */
  order: number;
  /** True when the linked article is a disambiguation page. */
  disambiguation?: boolean;
}

/** Everything the spider knows about its goal. */
export interface TargetProfile {
  title: string;
  /** Redirect titles that lead to the target ("USA" for "United States"). */
  aliases: ReadonlySet<string>;
  /** Short description + intro text, used for semantic ranking. */
  summary: string;
  /** Articles known to link to the target (fetched once at race start). */
  backlinks: ReadonlySet<string>;
}

export interface ScoredLink {
  link: CandidateLink;
  score: number;
}

export type RankMethod = 'semantic' | 'lexical';

export interface RankResult {
  /** Best first. */
  scored: ScoredLink[];
  method: RankMethod;
}

/** Orders candidate links by how promising they look for reaching the target. */
export interface Ranker {
  rank(target: TargetProfile, links: readonly CandidateLink[]): Promise<RankResult>;
}

/** Why the spider picked a link. */
export type DecisionReason =
  /** The target itself is linked from this page. */
  | 'target'
  /** The link leads to a page known to link to the target. */
  | 'backlink'
  /** Best semantic similarity to the target (sentence embeddings). */
  | 'semantic'
  /** Best lexical similarity (fallback when the model is unavailable). */
  | 'lexical'
  /** Nothing new to visit from here. */
  | 'dead-end';

export interface Decision {
  reason: DecisionReason;
  link: CandidateLink | null;
  score: number;
  /** The best few options considered, best first (shown as the spider's "thoughts"). */
  shortlist: ScoredLink[];
}
