/**
 * Difficulty levels. The spider is equally smart on every level (same brain,
 * same pathfinding); what changes is how fast it acts and how hard it
 * attacks the player.
 *
 *  - Easy: it only crawls and destroys its own page. No attacks. Slow
 *    thinking. Winnable.
 *  - Normal: adds web traps, fan lasers and word bombardments, about every
 *    25 s (more often in rage). Hard but winnable.
 *  - Hard: an attack every 4-8 s, chained, with no warning: webs, fan
 *    lasers, word bombs, fake target links full of mini-spiders and, now and
 *    then, a silk line on the cursor. When the player gets ahead, it steals
 *    their good links (at most one a minute). It runs across the page
 *    smashing the text; rage is always on. Expected win rate: almost zero.
 *
 * Attacks never come with a telegraph: they land instantly.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

/** Attacks the spider can launch at the player's pane. */
export type AttackId = 'web' | 'laser' | 'bombard' | 'decoy' | 'harass';

/** When the spider is in rage mode (faster, angrier, glowing eye). */
export type RageRule = 'never' | 'near-target' | 'always';

/**
 * Link snatch: the spider steals the link the player clicks, but only when
 * the player is winning (see game/snatch.ts).
 */
export interface SnatchRule {
  /** The player's first links are safe: no snatch before this many link hops. */
  safeHops: number;
  /** Seconds between two snatches. */
  cooldown: number;
}

export interface Difficulty {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Minimum time spent scanning each page (ms). */
  thinkMs: number;
  /** Crawling speed over the text (CSS px per second). */
  walkSpeed: number;
  /** Running speed for far links, as a multiple of walkSpeed (reached ~1000 px away). */
  sprint: number;
  /** Speed of a web zip (CSS px per second). */
  zipSpeed: number;
  /**
   * Links farther than this (px) are reached with a web zip; anything closer
   * is reached on foot, smashing the text on the way.
   */
  zipBeyond: number;
  /** Random destruction moves (laser cut, grab & throw, stomp) per second of crawling. */
  mischief: number;
  /** Chance that a foot crushes the word it lands on. */
  crush: number;
  /** Attacks on the player's pane (empty: the spider leaves the player alone). */
  attacks: AttackId[];
  /** Pause between two attacks, in seconds (random in this range). */
  cooldown: [number, number];
  /** Seconds before the first attack. */
  firstAttack: number;
  /** Chance that an attack is immediately followed by another one. */
  chain: number;
  /** Width of the fan laser's sweep (degrees). */
  laserFan: number;
  /** Link snatch (Hard only). */
  snatch: SnatchRule | null;
  rage: RageRule;
  /** How long webbed and covered links stay blocked (s). */
  webSeconds: number;
  coverSeconds: number;
  /** How long the silk drags the cursor (s), and the least time between two drags (s). */
  harassSeconds: number;
  harassGap: number;
  /** Fake target links planted at once, and the mini-spiders that burst out of one when clicked. */
  maxDecoys: number;
  decoyMinis: number;
  /** How talkative the spider is (0..1): the chance of a taunt at each key moment. */
  taunts: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'It only crawls and eats its own page. Slow thinker. Never touches you. Winnable.',
    thinkMs: 6500,
    walkSpeed: 70,
    sprint: 1.8,
    zipSpeed: 650,
    zipBeyond: 3600,
    mischief: 0.45,
    crush: 0.25,
    attacks: [],
    cooldown: [999, 999],
    firstAttack: 999,
    chain: 0,
    laserFan: 0,
    snatch: null,
    rage: 'never',
    webSeconds: 0,
    coverSeconds: 0,
    harassSeconds: 0,
    harassGap: 0,
    maxDecoys: 0,
    decoyMinis: 0,
    taunts: 0.35,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: 'Web traps, fan lasers and word bombs, about every 25 s. Hard but winnable.',
    thinkMs: 3200,
    walkSpeed: 125,
    sprint: 2.2,
    zipSpeed: 1100,
    zipBeyond: 4200,
    mischief: 0.75,
    crush: 0.4,
    attacks: ['web', 'laser', 'bombard'],
    cooldown: [22, 28],
    firstAttack: 14,
    chain: 0,
    laserFan: 16,
    snatch: null,
    rage: 'near-target',
    webSeconds: 7,
    coverSeconds: 8,
    harassSeconds: 0,
    harassGap: 0,
    maxDecoys: 0,
    decoyMinis: 0,
    taunts: 0.7,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'Everything, every few seconds, no warning. Get ahead and it steals your good links. Expected win rate: almost zero.',
    thinkMs: 250,
    walkSpeed: 300,
    sprint: 2.4,
    zipSpeed: 2300,
    zipBeyond: 5200,
    mischief: 1.1,
    crush: 0.55,
    attacks: ['web', 'laser', 'bombard', 'decoy', 'harass'],
    cooldown: [4, 8],
    firstAttack: 3,
    chain: 0.55,
    laserFan: 24,
    snatch: { safeHops: 3, cooldown: 60 },
    rage: 'always',
    webSeconds: 9,
    coverSeconds: 10,
    harassSeconds: 2,
    harassGap: 45,
    maxDecoys: 3,
    decoyMinis: 3,
    taunts: 1,
  },
};

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export function isDifficultyId(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

/**
 * In rage the spider thinks and walks faster, and attacks more often when
 * the rage is a reaction (Normal, near the target): on Hard, where it is
 * always on, the attack cadence stays the table's 4-8 s.
 */
export const RAGE = {
  think: 0.6,
  speed: 1.35,
  cooldown: 0.5,
} as const;
