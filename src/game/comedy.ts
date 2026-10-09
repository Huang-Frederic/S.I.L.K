/**
 * The comedy layer's words: the spider's taunts (short, lowercase, mono
 * speech bubbles), and the roast lines of the lose screen. Pure functions so
 * the rules (rate limit, picks) are easy to test.
 */

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

export const TAUNTS: Record<TauntEvent, string[]> = {
  start: ['let’s dance.', 'eight legs. zero chill.', 'catch me if you can.'],
  hop: ['+1.', 'keep up.', 'next.', 'too easy.'],
  snatch: ['mine now.', 'nom.', 'yoink.', 'thanks for the link.'],
  'player-near-target': ['you were so close.', 'don’t even think about it.'],
  web: ['stuck?', 'sticky situation.'],
  laser: ['pew.', 'denied.', 'everything burns.', 'crispy.'],
  bombard: ['incoming.', 'catch.', 'have some words.'],
  'decoy-planted': ['click me.', 'trust me.'],
  'decoy-clicked': ['gotcha.', 'say hi to the kids.', 'they’re hungry.', 'that was a nest.'],
  harass: ['let me help.', 'this way.', 'wrong way.'],
  'blocked-click': ['skill issue.', 'nope.'],
  'player-slow': ['too slow.', 'tick tock.', 'reading the whole thing?'],
  'player-hop': ['cute.', 'too slow.'],
  'give-up': ['skill issue.', 'gg no re.'],
  'spider-wins': ['gg.', 'too slow.', 'skill issue.'],
  'spider-loses': ['impossible.', 'this never happened.'],
};

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
    const pool = TAUNTS[event].filter((line) => line !== this.lastLine);
    const line = pool[Math.floor(this.random() * pool.length)] ?? TAUNTS[event][0];
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
  const words = facts.wordsEaten.toLocaleString('en-US');
  const lines = [
    `The spider ate ${words} word${facts.wordsEaten === 1 ? '' : 's'} and your dignity.`,
    '8 legs, 1 eye, 0 mercy.',
    'Maybe try Easy. Or don’t.',
    'It didn’t even need all eight legs.',
    `${facts.spiderHops} hop${facts.spiderHops === 1 ? '' : 's'}. Zero hesitation.`,
    'The spider would like to thank your cursor.',
  ];
  if (facts.difficulty === 'easy') lines.push('Lost on Easy. The spider is telling everyone.');
  if (facts.difficulty === 'hard') lines.push('You were so close. (You weren’t.)');
  if (facts.decoysClicked > 0) lines.push('You clicked a fake link. The babies say thanks.');
  if (facts.snatched) lines.push('It stole your best link. And your race.');
  return lines;
}

export function pickRoast(facts: RoastFacts, random: () => number = Math.random): string {
  const lines = roastLines(facts);
  return lines[Math.floor(random() * lines.length)] ?? lines[0];
}

/** Lines for a player who gave up. */
export const GIVE_UP_ROASTS = ['Rage quit detected.', 'The spider respects the honesty. Not you, though.', 'Skill issue, says the spider.'];
