import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../src/game/difficulty';
import { linkCloseness, maySnatch, pageCloseness, type Lookup, type SnatchFacts } from '../src/game/snatch';

const lookup: Lookup = {
  isTarget: (t) => t === 'Tidewatch Observatory' || t === 'Tidewatch',
  isBridge: (t) => t === 'Lantern Festival' || t === 'Copper Lighthouse',
};

const rule = DIFFICULTIES.hard.snatch;

/** A click that would put the player ahead, late enough in the race. */
const winning: SnatchFacts = { now: 75, playerLinks: 4, done: 0, lastAt: null, link: 1, spider: 3, visited: false };

describe('closeness to the target', () => {
  it('rates a link by where it leads', () => {
    expect(linkCloseness('Tidewatch Observatory', lookup)).toBe(0);
    expect(linkCloseness('Tidewatch', lookup)).toBe(0);
    expect(linkCloseness('Lantern Festival', lookup)).toBe(1);
    expect(linkCloseness('Silk', lookup)).toBe(3);
  });

  it('rates a page by its links (redirect titles included)', () => {
    expect(pageCloseness([{ title: 'Silk' }, { title: 'Tidewatch', linkedTitle: 'Tidewatch' }], lookup)).toBe(1);
    expect(pageCloseness([{ title: 'Silk' }, { title: 'Copper Lighthouse' }], lookup)).toBe(2);
    expect(pageCloseness([{ title: 'Silk' }, { title: 'Loom' }], lookup)).toBe(3);
    expect(pageCloseness([], lookup)).toBe(3);
  });
});

describe('link snatch rules (Hard)', () => {
  it('steals an interesting link that would put the player ahead', () => {
    expect(maySnatch(rule, winning)).toBe(true);
    // The target link itself, while the spider is still one hop away.
    expect(maySnatch(rule, { ...winning, link: 0, spider: 1 })).toBe(true);
  });

  it('leaves the player alone when they are not winning', () => {
    // Even: both one hop from the target.
    expect(maySnatch(rule, { ...winning, link: 1, spider: 1 })).toBe(false);
    // A dull link is never worth it.
    expect(maySnatch(rule, { ...winning, link: 3, spider: 3 })).toBe(false);
  });

  it('never touches the first three links', () => {
    for (const playerLinks of [0, 1, 2]) expect(maySnatch(rule, { ...winning, playerLinks })).toBe(false);
    expect(maySnatch(rule, { ...winning, playerLinks: 3 })).toBe(true);
  });

  it('waits a minute after the start', () => {
    expect(maySnatch(rule, { ...winning, now: 59.9 })).toBe(false);
    expect(maySnatch(rule, { ...winning, now: 60 })).toBe(true);
  });

  it('happens at most once a race', () => {
    expect(maySnatch(rule, { ...winning, done: 1, lastAt: 70, now: 400 })).toBe(false);
  });

  it('never sends the spider back to a page it has seen', () => {
    expect(maySnatch(rule, { ...winning, visited: true })).toBe(false);
  });

  it('is Hard only', () => {
    expect(maySnatch(DIFFICULTIES.easy.snatch, winning)).toBe(false);
    expect(maySnatch(DIFFICULTIES.normal.snatch, winning)).toBe(false);
  });
});
