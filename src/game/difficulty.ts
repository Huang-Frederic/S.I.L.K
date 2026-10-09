/**
 * Difficulty levels. The spider is equally smart on every level (same brain,
 * same pathfinding); what changes is how fast it acts and how hard it
 * attacks the player.
 *
 *  - Easy: it only crawls and destroys its own page. No attacks. Slow
 *    thinking. Winnable.
 *  - Normal: adds web traps, laser snipes and word bombardments, about every
 *    25 s (more often in rage). Hard but winnable.
 *  - Hard: everything, every 4-8 s, chained, with no warning; it snatches the
 *    links you reach for, plants decoys, lays eggs, turns off the lights and
 *    tugs your cursor. Rage is always on. Expected win rate: almost zero.
 *
 * Attacks never come with a telegraph: they land instantly.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

/** Attacks the spider can launch at the player's pane. */
export type AttackId = 'web' | 'laser' | 'bombard' | 'decoy' | 'eggs' | 'blackout' | 'harass';

/** When the spider is in rage mode (faster, angrier, glowing eye). */
export type RageRule = 'never' | 'near-target' | 'always';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Minimum time spent scanning each page (ms). */
  thinkMs: number;
  /** Crawling speed over the text (CSS px per second). */
  walkSpeed: number;
  /** Speed of a web zip (CSS px per second). */
  zipSpeed: number;
  /** Links farther than this (px) are reached with a web zip instead of walking. */
  zipBeyond: number;
  /** Random destruction moves (laser cut, grab & throw, stomp) per second of crawling. */
  mischief: number;
  /** Attacks on the player's pane (empty: the spider leaves the player alone). */
  attacks: AttackId[];
  /** Pause between two attacks, in seconds (random in this range). */
  cooldown: [number, number];
  /** Seconds before the first attack. */
  firstAttack: number;
  /** Chance that an attack is immediately followed by another one. */
  chain: number;
  /** Link snatch: distance from the cursor (px) and cooldown (s). Hard only. */
  snatch: { radius: number; cooldown: number } | null;
  rage: RageRule;
  /** How long webbed and covered links stay blocked (s). */
  webSeconds: number;
  coverSeconds: number;
  blackoutSeconds: number;
  hatchSeconds: number;
  harassSeconds: number;
  /** Decoy target links planted at once, and the time penalty for clicking one. */
  maxDecoys: number;
  decoyPenaltyMs: number;
  /** How talkative the spider is (0..1): the chance of a taunt at each key moment. */
  taunts: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'It only crawls and eats its own page. Slow thinker. Never touches you. Winnable.',
    thinkMs: 6500,
    walkSpeed: 62,
    zipSpeed: 650,
    zipBeyond: 620,
    mischief: 0.22,
    attacks: [],
    cooldown: [999, 999],
    firstAttack: 999,
    chain: 0,
    snatch: null,
    rage: 'never',
    webSeconds: 0,
    coverSeconds: 0,
    blackoutSeconds: 0,
    hatchSeconds: 3,
    harassSeconds: 0,
    maxDecoys: 0,
    decoyPenaltyMs: 0,
    taunts: 0.35,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: 'Web traps, laser snipes and word bombs, about every 25 s. Hard but winnable.',
    thinkMs: 3200,
    walkSpeed: 108,
    zipSpeed: 1100,
    zipBeyond: 380,
    mischief: 0.32,
    attacks: ['web', 'laser', 'bombard'],
    cooldown: [22, 28],
    firstAttack: 14,
    chain: 0,
    snatch: null,
    rage: 'near-target',
    webSeconds: 7,
    coverSeconds: 8,
    blackoutSeconds: 0,
    hatchSeconds: 3,
    harassSeconds: 0,
    maxDecoys: 0,
    decoyPenaltyMs: 15_000,
    taunts: 0.7,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'Everything, every few seconds, no warning. It steals the links you reach for. Expected win rate: almost zero.',
    thinkMs: 250,
    walkSpeed: 250,
    zipSpeed: 2300,
    zipBeyond: 150,
    mischief: 0.5,
    attacks: ['web', 'laser', 'bombard', 'decoy', 'eggs', 'blackout', 'harass'],
    cooldown: [4, 8],
    firstAttack: 3,
    chain: 0.55,
    snatch: { radius: 120, cooldown: 8 },
    rage: 'always',
    webSeconds: 9,
    coverSeconds: 10,
    blackoutSeconds: 6,
    hatchSeconds: 3,
    harassSeconds: 2,
    maxDecoys: 3,
    decoyPenaltyMs: 15_000,
    taunts: 1,
  },
};

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export function isDifficultyId(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

/** In rage the spider thinks, walks and attacks faster. */
export const RAGE = {
  think: 0.6,
  speed: 1.35,
  cooldown: 0.5,
} as const;
