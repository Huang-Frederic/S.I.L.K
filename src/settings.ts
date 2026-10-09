/**
 * Per-browser preferences and stats, stored in localStorage. Storage can be
 * unavailable (private mode, blocked site data), so every access is guarded
 * and the game works without it.
 */
import { DEFAULT_LANG, isLang, type Lang } from './i18n';

const KEYS = {
  reduceMotion: 'silk.reduceMotion',
  hardWins: 'silk.hardWins',
  lang: 'silk.lang',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not important: the setting just won't be remembered.
  }
}

const systemPrefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let reduceMotion = read(KEYS.reduceMotion) === null ? systemPrefersReducedMotion() : read(KEYS.reduceMotion) === '1';
const listeners = new Set<() => void>();

export const settings = {
  /** No screen shake, shorter transitions. Never changes the difficulty. */
  get reduceMotion(): boolean {
    return reduceMotion;
  },

  set reduceMotion(value: boolean) {
    reduceMotion = value;
    write(KEYS.reduceMotion, value ? '1' : '0');
    for (const listener of listeners) listener();
  },

  /** Scales an animation duration down when Reduce motion is on. */
  duration(seconds: number): number {
    return reduceMotion ? seconds * 0.4 : seconds;
  },

  onChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The game's language (English until the player picks another one). */
  get lang(): Lang {
    const stored = read(KEYS.lang);
    return isLang(stored) ? stored : DEFAULT_LANG;
  },

  set lang(value: Lang) {
    write(KEYS.lang, value);
  },

  /** Wins on Hard in this browser (never a global or invented stat). */
  get hardWins(): number {
    const value = Number(read(KEYS.hardWins));
    return Number.isInteger(value) && value > 0 ? value : 0;
  },

  recordHardWin(): number {
    const wins = this.hardWins + 1;
    write(KEYS.hardWins, String(wins));
    return wins;
  },
};
