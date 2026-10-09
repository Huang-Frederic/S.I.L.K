/**
 * A small fictional encyclopedia ("the Silken Isles") for end-to-end runs and
 * tests. The link graph is written by hand; the prose around the links is
 * generated from a seeded random generator so that every page has enough
 * text for the spider to walk on.
 */
import type { FakePage } from './fakeWiki';

/** Page -> pages it links to (in reading order). */
const GRAPH: Record<string, string[]> = {
  'Silken Isles': ['Loomhaven', 'Amber Reef', 'Northern Ferry', 'Great Canal', 'Lantern Festival', 'Weavers Guild'],
  Loomhaven: ['Silken Isles', 'Weavers Guild', 'Saltwind Market', 'Old Archive', 'Spindle Bridge', 'Harbour Foundry', 'Sunken Library'],
  'Weavers Guild': ['Loomhaven', 'Silk', 'Thread Monastery', 'Moth Orchard', 'Saltwind Market'],
  Silk: ['Spider', 'Moth Orchard', 'Weavers Guild', 'Spider silk', 'Saltwind Market'],
  Spider: ['Spider silk', 'Moth Orchard', 'Copper Lighthouse', 'Silk'],
  'Spider silk': ['Spider', 'Silk', 'Tidewatch Observatory', 'Glass Quarry'],
  'Moth Orchard': ['Silk', 'Windmill Row', 'Lantern Festival', 'Glass Quarry'],
  'Saltwind Market': ['Loomhaven', 'Northern Ferry', 'Harbour Foundry', 'Amber Reef'],
  'Old Archive': ['Loomhaven', 'Thread Monastery', 'Moonlit Causeway', 'Lighthouse'],
  'Spindle Bridge': ['Great Canal', 'Loomhaven', 'Windmill Row'],
  'Harbour Foundry': ['Copper Lighthouse', 'Glass Quarry', 'Saltwind Market'],
  'Copper Lighthouse': ['Tidewatch Observatory', 'Amber Reef', 'Harbour Foundry', 'Moonlit Causeway'],
  'Tidewatch Observatory': ['Copper Lighthouse', 'Moonlit Causeway', 'Spider silk'],
  'Amber Reef': ['Silken Isles', 'Copper Lighthouse', 'Northern Ferry'],
  'Northern Ferry': ['Amber Reef', 'Saltwind Market', 'Great Canal'],
  'Great Canal': ['Spindle Bridge', 'Northern Ferry', 'Windmill Row', 'Silken Isles'],
  'Windmill Row': ['Moth Orchard', 'Great Canal', 'Glass Quarry'],
  'Glass Quarry': ['Harbour Foundry', 'Windmill Row', 'Thread Monastery'],
  'Thread Monastery': ['Old Archive', 'Weavers Guild', 'Moonlit Causeway'],
  'Moonlit Causeway': ['Tidewatch Observatory', 'Thread Monastery', 'Lantern Festival'],
  'Lantern Festival': ['Silken Isles', 'Moonlit Causeway', 'Moth Orchard'],
  Lighthouse: ['Copper Lighthouse', 'Glass Lighthouse'],
  'Glass Lighthouse': ['Glass Quarry', 'Lighthouse'],
};

const DESCRIPTIONS: Record<string, string> = {
  'Silken Isles': 'Fictional archipelago',
  Loomhaven: 'Capital of the Silken Isles',
  Spider: 'Eight-legged weaver',
  'Tidewatch Observatory': 'Lighthouse-top observatory',
  Lighthouse: 'Topics referred to by the same term',
};

const ADJECTIVES = ['ancient', 'misty', 'copper-roofed', 'quiet', 'northern', 'gilded', 'drifting', 'hidden', 'amber', 'woven', 'salt-white', 'lantern-lit'];
const NOUNS = ['harbour', 'loom', 'orchard', 'observatory', 'bridge', 'library', 'market', 'canal', 'cloister', 'windmill', 'quarry', 'garden', 'archive', 'foundry', 'ferry', 'tower', 'causeway', 'meadow'];
const VERBS = ['overlooks', 'supplies', 'inspired', 'shelters', 'borders', 'documents', 'trades with', 'was rebuilt after', 'is often compared to', 'depends on'];
const FILLERS = [
  'Travellers describe the place as calm in winter and crowded in summer.',
  'Local records mention it as early as the third age of the isles.',
  'Its name is said to come from an old weaving term.',
  'Several small workshops still operate nearby.',
  'The surrounding paths are lined with mulberry trees.',
  'A yearly survey counts the moths that nest under its eaves.',
  'Most of its archives were copied by hand during the long rains.',
  'Children learn its history through a counting song.',
];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function sentenceAbout(subject: string, link: string | null, random: () => number): string {
  const object = `${pick(ADJECTIVES, random)} ${pick(NOUNS, random)}`;
  const linked = link ? `[[${link}]]` : `the ${pick(NOUNS, random)}`;
  const templates = [
    `${subject} ${pick(VERBS, random)} the ${object} of ${linked}.`,
    `Historians link ${subject} to ${linked}, especially its ${object}.`,
    `From the ${object}, one can see ${linked} on clear mornings.`,
    `The ${object} near ${linked} was designed by the same guild of builders.`,
  ];
  const sentence = pick(templates, random);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function demoPages(): FakePage[] {
  const pages: FakePage[] = [];
  let seed = 7;
  for (const [title, links] of Object.entries(GRAPH)) {
    const random = rng(seed++);
    const paragraphs: string[] = [];
    let current: string[] = [`${title} is a place of the Silken Isles.`];
    links.forEach((link, i) => {
      current.push(sentenceAbout(title, link, random));
      if (random() < 0.6) current.push(pick(FILLERS, random));
      current.push(sentenceAbout('the place', null, random));
      if (i % 2 === 1) {
        paragraphs.push(current.join(' '));
        current = [];
      }
    });
    if (current.length) paragraphs.push(current.join(' '));
    const [lead, ...rest] = paragraphs;
    pages.push({
      title,
      lead: [lead, rest[0] ?? pick(FILLERS, random)],
      sections: [
        { heading: 'History', paragraphs: rest.slice(1, 3).length ? rest.slice(1, 3) : [pick(FILLERS, random)] },
        { heading: 'Legacy', paragraphs: [rest.slice(3).join(' ') || pick(FILLERS, random), pick(FILLERS, random)] },
      ],
      hiddenLinks: ['Reference Only Page'],
      description: DESCRIPTIONS[title],
      disambiguation: title === 'Lighthouse',
    });
  }
  // A redirect, so that redirect handling is exercised.
  pages.push({ title: 'Loom Haven', lead: [], redirectTo: 'Loomhaven' });
  pages.push({ title: 'Observatory of Tidewatch', lead: [], redirectTo: 'Tidewatch Observatory' });
  return pages;
}
