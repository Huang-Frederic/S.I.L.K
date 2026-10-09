/**
 * Lexical relevance: the fallback ranking when the embedding model is not
 * available. It rewards links sharing (stemmed) words with the target's
 * title, description and summary, plus character trigram overlap with the
 * target title. When nothing matches at all, it prefers short, early links:
 * those tend to be broad topics that open more doors.
 */
import type { CandidateLink, Ranker, RankResult, ScoredLink, TargetProfile } from './types';

const STOPWORDS = new Set(
  (
    // English
    'a an and are as at be been but by for from has have he her his in into is it its of on or that the their ' +
    'there they this to was were which who will with not also than then these those other such may can one two ' +
    'first new used use known most more many some about after before over under between during within without ' +
    // French (accents stripped, like the tokens)
    'le la les de des du un une et en au aux dans par pour sur avec sans sous est sont ete etait qui que quoi dont ou ' +
    'ce cet cette ces son sa ses leur leurs il elle ils elles on se ne pas plus ainsi aussi comme mais donc car entre ' +
    'apres avant pendant depuis vers chez tres tout tous toute toutes autre autres meme deux premier premiere'
  ).split(' '),
);

/** Lists and indexes (English and French): broad, but rarely the way. */
const LIST_PAGE = /^(List|Index|Outline) of |^(Liste|Index) (des?|du|d['’])/;

/** Lower-cased, accent-free, stemmed content words. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

/** A deliberately light stemmer: plurals and a few common suffixes. */
export function stem(word: string): string {
  if (word.length <= 3 || /^\d+$/.test(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1);
  return word;
}

function trigrams(text: string): Set<string> {
  const s = ` ${text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface LexicalProfile {
  weights: Map<string, number>;
  titleTrigrams: Set<string>;
}

/** Word weights for a target: title words count most, then description, then summary. */
export function lexicalProfile(target: TargetProfile): LexicalProfile {
  const weights = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const token of tokenize(text)) weights.set(token, Math.max(weights.get(token) ?? 0, weight));
  };
  add(target.summary, 1);
  for (const alias of target.aliases) add(alias, 2);
  add(target.title, 3);
  return { weights, titleTrigrams: trigrams(target.title) };
}

/** Relevance of one link (higher is better, roughly in [0, 4]). */
export function lexicalScore(profile: LexicalProfile, link: CandidateLink, total: number): number {
  const tokens = [...new Set(tokenize(`${link.title} ${link.text}`))];
  let overlap = 0;
  for (const token of tokens) overlap += profile.weights.get(token) ?? 0;
  const wordScore = tokens.length ? overlap / Math.sqrt(tokens.length) : 0;
  const shapeScore = jaccard(trigrams(link.title), profile.titleTrigrams);
  // Tie-breakers for links that share nothing with the target.
  const early = total > 1 ? 1 - link.order / total : 1;
  const words = link.title.split(' ').length;
  const broad = words <= 2 ? 0.05 : 0;
  const penalty = (link.disambiguation ? 0.3 : 0) + (LIST_PAGE.test(link.title) ? 0.1 : 0) + (/^\d+$/.test(link.title) ? 0.1 : 0);
  return wordScore + shapeScore + 0.1 * early + broad - penalty;
}

/** Sorts best first; ties go to the link that appears first in the article. */
export function byScore(a: ScoredLink, b: ScoredLink): number {
  return b.score - a.score || a.link.order - b.link.order;
}

export class LexicalRanker implements Ranker {
  private cached: { target: TargetProfile; profile: LexicalProfile } | null = null;

  async rank(target: TargetProfile, links: readonly CandidateLink[]): Promise<RankResult> {
    if (this.cached?.target !== target) this.cached = { target, profile: lexicalProfile(target) };
    const { profile } = this.cached;
    const total = links.reduce((max, link) => Math.max(max, link.order + 1), 0);
    const scored = links.map((link) => ({ link, score: lexicalScore(profile, link, total) })).sort(byScore);
    return { scored, method: 'lexical' };
  }
}
