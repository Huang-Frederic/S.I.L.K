/**
 * Choosing the start and target articles.
 *
 * A random start is a genuinely random Wikipedia article (filtered so that it
 * is a real article with some substance), which gives every race a fresh
 * flavour. A random target comes from a curated pool of well-known, well
 * linked topics, so that every race is winnable in a handful of hops.
 */
import type { PageInfo, WikiClient } from '../wiki/client';
import { normalizeTitle } from '../wiki/titles';

export const TARGET_POOL: readonly string[] = [
  // Science & nature
  'Albert Einstein', 'Isaac Newton', 'Charles Darwin', 'Marie Curie', 'Black hole', 'Photosynthesis', 'DNA',
  'Evolution', 'Volcano', 'Earthquake', 'Moon', 'Mars', 'Jupiter', 'Sun', 'Milky Way', 'Big Bang', 'Gravity',
  'Electricity', 'Oxygen', 'Gold', 'Diamond', 'Rainbow', 'Tornado', 'Dinosaur', 'Tyrannosaurus', 'Shark',
  'Octopus', 'Penguin', 'Elephant', 'Tiger', 'Wolf', 'Honey bee', 'Butterfly', 'Whale', 'Coral reef',
  'Amazon rainforest', 'Sahara', 'Antarctica', 'Mount Everest', 'Nile', 'Pacific Ocean', 'Great Barrier Reef',
  'Nikola Tesla', 'Ada Lovelace', 'Alan Turing', 'Galileo Galilei', 'Mount Fuji', 'Grand Canyon',
  // Technology
  'Internet', 'Computer', 'Smartphone', 'Artificial intelligence', 'Video game', 'Robot', 'Bicycle', 'Airplane',
  'Steam engine', 'Printing press', 'Telephone', 'Television', 'Rocket', 'Satellite', 'Wikipedia', 'Linux',
  'Bitcoin', 'World Wide Web',
  // History
  'Ancient Egypt', 'Roman Empire', 'Ancient Greece', 'Vikings', 'Napoleon', 'Julius Caesar', 'Cleopatra',
  'Genghis Khan', 'World War II', 'French Revolution', 'Renaissance', 'Industrial Revolution', 'Cold War',
  'Moon landing', 'Titanic', 'Great Wall of China', 'Stonehenge', 'Colosseum', 'Machu Picchu', 'Silk Road',
  'Aztecs', 'Samurai', 'Knight', 'Piracy', 'Aristotle', 'Atlantis',
  // Arts & culture
  'William Shakespeare', 'Leonardo da Vinci', 'Mona Lisa', 'Pablo Picasso', 'Vincent van Gogh', 'Frida Kahlo',
  'Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Jazz', 'Rock music', 'Hip-hop', 'The Beatles',
  'Michael Jackson', 'Star Wars', 'Harry Potter', 'The Lord of the Rings', 'Batman', 'Super Mario', 'Pokémon',
  'Minecraft', 'Tetris', 'Chess', 'Rubik\'s Cube', 'Lego', 'Opera', 'Ballet', 'Anime', 'Origami', 'Zeus',
  'Dragon', 'Unicorn', 'Vampire', 'Sherlock Holmes', 'Dracula', 'Halloween', 'Christmas', 'Fireworks', 'Circus',
  'Magic (illusion)', 'Buddhism', 'Philosophy', 'Democracy', 'Mathematics', 'Pi', 'Money', 'Music', 'Alphabet',
  'Library', 'Bermuda Triangle',
  // Sports
  'Olympic Games', 'FIFA World Cup', 'Basketball', 'Tennis', 'Volleyball', 'Sumo', 'Skateboarding', 'Surfing',
  'Snowboarding',
  // Food
  'Pizza', 'Coffee', 'Tea', 'Chocolate', 'Sushi', 'Bread', 'Cheese', 'Banana', 'Apple', 'Rice', 'Ice cream',
  'Hamburger', 'Wine', 'Honey', 'Tomato', 'Potato',
  // Places & landmarks
  'Paris', 'London', 'Tokyo', 'New York City', 'Rome', 'Venice', 'Istanbul', 'Cairo', 'Rio de Janeiro', 'Sydney',
  'Iceland', 'Japan', 'Brazil', 'India', 'Canada', 'Mexico', 'Australia', 'Hawaii', 'Eiffel Tower',
  'Statue of Liberty',
  // Everyday things (and a few spiders, obviously)
  'Spider', 'Spider silk', 'Cat', 'Dog', 'Horse', 'Clock', 'Calendar', 'Lighthouse', 'Castle', 'Bridge',
];

export type Rng = () => number;

export function pickRandom<T>(items: readonly T[], rng: Rng = Math.random): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/** A pool target different from the excluded titles. */
export function pickRandomTarget(exclude: readonly string[] = [], rng: Rng = Math.random): string {
  const excluded = new Set(exclude.map(normalizeTitle));
  const choices = TARGET_POOL.filter((title) => !excluded.has(title));
  return pickRandom(choices.length ? choices : TARGET_POOL, rng);
}

/** Minimum wikitext size for a random start article (filters out stubs). */
const MIN_START_LENGTH = 6000;

/**
 * A random real article to start from. Falls back to the curated pool when
 * the API is unavailable or only returned stubs.
 */
export async function pickRandomStart(client: WikiClient, exclude: readonly string[] = [], rng: Rng = Math.random): Promise<string> {
  const excluded = new Set(exclude.map(normalizeTitle));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidates = (await client.fetchRandomArticles(15)).filter(
        (page) =>
          page.length >= MIN_START_LENGTH &&
          !page.disambiguation &&
          !excluded.has(page.title) &&
          !/^(List|Lists|Index|Outline) of /.test(page.title),
      );
      if (candidates.length) return pickRandom(candidates, rng).title;
    }
  } catch {
    // Offline or throttled: the pool still makes for a fine race.
  }
  return pickRandomTarget(exclude, rng);
}

export interface ValidatedPair {
  start: PageInfo;
  target: PageInfo;
}

export type PairValidation =
  | { ok: true; pair: ValidatedPair }
  | { ok: false; errors: { start?: string; target?: string; general?: string } };

/**
 * Checks that both titles are existing, non-disambiguation articles and that
 * they differ once redirects are resolved.
 */
export async function validatePair(client: WikiClient, start: string, target: string): Promise<PairValidation> {
  const startTitle = normalizeTitle(start);
  const targetTitle = normalizeTitle(target);
  const errors: { start?: string; target?: string; general?: string } = {};
  if (!startTitle) errors.start = 'Choose a start article.';
  if (!targetTitle) errors.target = 'Choose a target article.';
  if (errors.start || errors.target) return { ok: false, errors };

  let infos: Map<string, PageInfo>;
  try {
    infos = await client.fetchPageInfo([startTitle, targetTitle]);
  } catch {
    return { ok: false, errors: { general: 'Wikipedia could not be reached. Check your connection and try again.' } };
  }
  const startInfo = infos.get(startTitle);
  const targetInfo = infos.get(targetTitle);

  const check = (info: PageInfo | undefined, title: string): string | undefined => {
    if (!info || !info.exists) return `No English Wikipedia article is called “${title}”.`;
    if (info.disambiguation) return `“${info.title}” is a disambiguation page. Pick a more specific article.`;
    return undefined;
  };
  errors.start = check(startInfo, startTitle);
  errors.target = check(targetInfo, targetTitle);
  if (!errors.start && !errors.target && startInfo!.title === targetInfo!.title) {
    errors.target = 'The target must be a different article from the start.';
  }
  if (errors.start || errors.target) return { ok: false, errors };
  return { ok: true, pair: { start: startInfo!, target: targetInfo! } };
}
