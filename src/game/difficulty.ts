/**
 * Difficulty only changes how fast the spider acts, never how smart it is:
 * how long it "thinks" on each page and how fast it crawls to its link.
 * On Easy a human who knows a decent route should win comfortably.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  blurb: string;
  /** Minimum time spent thinking on each page (ms). */
  thinkMs: number;
  /** Walking speed along lines of text (CSS px per second). */
  walkSpeed: number;
  /** Speed when abseiling on its silk thread between distant lines (CSS px per second). */
  ropeSpeed: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'A sleepy spider that ponders every page.',
    thinkMs: 7000,
    walkSpeed: 55,
    ropeSpeed: 320,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: 'A curious spider at a steady crawl.',
    thinkMs: 3500,
    walkSpeed: 110,
    ropeSpeed: 650,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'A caffeinated spider. Good luck.',
    thinkMs: 1200,
    walkSpeed: 230,
    ropeSpeed: 1200,
  },
};

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

export function isDifficultyId(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard';
}
