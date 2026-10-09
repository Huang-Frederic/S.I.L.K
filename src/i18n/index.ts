/**
 * The game's languages. The language picks both the texts of the game and
 * the Wikipedia the race is run on (fr.wikipedia.org or en.wikipedia.org).
 * French is the default.
 */
import { en, type Strings } from './en';
import { fr } from './fr';

export type Lang = 'fr' | 'en';
export type { Strings };

export const LANGS: readonly Lang[] = ['fr', 'en'];
export const DEFAULT_LANG: Lang = 'fr';

const STRINGS: Record<Lang, Strings> = { fr, en };

let current: Lang = DEFAULT_LANG;

export function isLang(value: unknown): value is Lang {
  return value === 'fr' || value === 'en';
}

/** The current language. */
export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = STRINGS[next].htmlLang;
}

/** Texts in the current language (or in `of`). */
export function t(of: Lang = current): Strings {
  return STRINGS[of];
}
