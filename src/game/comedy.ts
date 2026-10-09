/**
 * The comedy layer's words: the spider's taunts (short, lowercase, mono
 * speech bubbles), and the roast lines of the lose screen. Pure functions so
 * the rules (rate limit, picks) are easy to test; the lines themselves are
 * in the language files (i18n).
 */
import { t } from '../i18n';

/** Key moments the spider may comment on. */
export type TauntEvent =
  | 'start'
  | 'hop'
  | 'snatch'
  | 'player-near-target'
  | 'web'
  | 'laser'
  | 'bombard'
  | 'decoy-planted'
  | 'decoy-clicked'
  | 'harass'
  | 'blocked-click'
  | 'player-slow'
  | 'player-hop'
  | 'give-up'
  | 'spider-wins'
  | 'spider-loses';

/** The spider's lines for each moment, in the current language. */
export function taunts(): Record<TauntEvent, string[]> {
  return t().taunts;
}

/** Minimum time between two taunts, in seconds. */
export const TAUNT_GAP = 6;

/**
 * Rate-limited taunt picker: at most one line every `gap` seconds, said with
 * probability `chattiness` (forced lines skip both checks), and never the
 * same line twice in a row.
 */
export class TauntPicker {
  private last = -Infinity;
  private lastLine = '';

  constructor(
    private readonly chattiness: number,
    private readonly gap = TAUNT_GAP,
    private readonly random: () => number = Math.random,
  ) {}

  /** Returns the line to say now, or null. `now` is in seconds. */
  pick(event: TauntEvent, now: number, force = false): string | null {
    if (!force && (now - this.last < this.gap || this.random() >= this.chattiness)) return null;
    const lines = taunts()[event];
    const pool = lines.filter((line) => line !== this.lastLine);
    const line = pool[Math.floor(this.random() * pool.length)] ?? lines[0];
    this.last = now;
    this.lastLine = line;
    return line;
  }
}

export interface RoastFacts {
  wordsEaten: number;
  spiderHops: number;
  difficulty: 'easy' | 'normal' | 'hard';
  /** Fake links the player clicked. */
  decoysClicked: number;
  /** The spider stole the player's link. */
  snatched: boolean;
}

/** Lose-screen roast lines, built from real numbers of the race. */
export function roastLines(facts: RoastFacts): string[] {
  return t().roasts(facts);
}

export function pickRoast(facts: RoastFacts, random: () => number = Math.random): string {
  const lines = roastLines(facts);
  return lines[Math.floor(random() * lines.length)] ?? lines[0];
}

/** Lines for a player who gave up. */
export function giveUpRoasts(): string[] {
  return t().giveUpRoasts;
}
