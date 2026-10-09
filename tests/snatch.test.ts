import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../src/game/difficulty';
import { closer, hopsLeft, maySnatch, snatchOpen, type Lookup, type SnatchFacts, type Standing } from '../src/game/snatch';

const lookup: Lookup = {
  isTarget: (t) => t === 'Tidewatch Observatory' || t === 'Tidewatch',
  isBridge: (t) => t === 'Copper Lighthouse' || t === 'Moonlit Causeway',
};

const rule = DIFFICULTIES.hard.snatch;
const at = (hops: Standing['hops'], similarity: number | null = null): Standing => ({ hops, similarity });

/**
 * A click that keeps a winning player ahead: from a page far from the
 * target to one that links to a page linking to it, while the spider is
 * still far away.
 */
const winning: SnatchFacts = { now: 30, playerLinks: 4, lastAt: null, player: at(3, 0.2), link: at(2, 0.3), spider: at(3, 0.25), visited: false };

describe('hops left to the target', () => {
  it('reads them off a page and its links', () => {
    expect(hopsLeft('Tidewatch Observatory', [], lookup)).toBe(0);
    expect(hopsLeft('Spider silk', [{ title: 'Silk' }, { title: 'Tidewatch Observatory' }], lookup)).toBe(1);
    // A known backlink, even if its links are not known.
    expect(hopsLeft('Copper Lighthouse', [], lookup)).toBe(1);
    expect(hopsLeft('Harbour Foundry', [{ title: 'Glass Quarry' }, { title: 'Copper Lighthouse' }], lookup)).toBe(2);
    expect(hopsLeft('Moth Orchard', [{ title: 'Silk' }, { title: 'Glass Quarry' }], lookup)).toBe(3);
  });

  it('follows redirect titles', () => {
    expect(hopsLeft('Spider silk', [{ title: 'Tidewatch', linkedTitle: 'Tidewatch' }], lookup)).toBe(1);
    expect(hopsLeft('Old Archive', [{ title: 'Moonlit Causeway', linkedTitle: 'Moonlit causeway' }], lookup)).toBe(2);
  });
});

describe('closer to the target', () => {
  it('counts hops first, then meaning', () => {
    expect(closer(at(2, 0.1), at(3, 0.9))).toBe(true);
    expect(closer(at(3, 0.5), at(3, 0.3))).toBe(true);
    expect(closer(at(3, 0.3), at(3, 0.5))).toBe(false);
  });

  it('calls near-equal meanings, or unknown ones, a tie', () => {
    expect(closer(at(3, 0.31), at(3, 0.3))).toBe(false);
    expect(closer(at(3, null), at(3, 0.1))).toBe(false);
    expect(closer(at(2, null), at(3, null))).toBe(true);
  });
});

describe('link snatch rules (Hard)', () => {
  it('steals a good link from a player who is ahead', () => {
    expect(maySnatch(rule, winning)).toBe(true);
    // Same hops left for everyone: the link closest in meaning wins it.
    expect(maySnatch(rule, { ...winning, link: at(3, 0.5), spider: at(3, 0.3) })).toBe(true);
  });

  it('never steals the final link, nor the one leading to it', () => {
    expect(maySnatch(rule, { ...winning, player: at(1, 0.6), link: at(0, 1) })).toBe(false);
    expect(maySnatch(rule, { ...winning, link: at(1, 0.5) })).toBe(false);
  });

  it('leaves the player alone when they are not winning', () => {
    // The spider is as close (or closer).
    expect(maySnatch(rule, { ...winning, spider: at(2, 0.3) })).toBe(false);
    expect(maySnatch(rule, { ...winning, spider: at(1, 0.1) })).toBe(false);
    // A link that does not take the player any closer.
    expect(maySnatch(rule, { ...winning, player: at(2, 0.4), link: at(2, 0.35) })).toBe(false);
    expect(maySnatch(rule, { ...winning, link: at(3, 0.21) })).toBe(false);
  });

  it('never touches the first three links', () => {
    for (const playerLinks of [0, 1, 2]) expect(maySnatch(rule, { ...winning, playerLinks })).toBe(false);
    expect(maySnatch(rule, { ...winning, playerLinks: 3 })).toBe(true);
  });

  it('waits a minute between two snatches, and that is the only limit', () => {
    // Right from the fourth link: no wait at the start of the race.
    expect(maySnatch(rule, { ...winning, now: 8 })).toBe(true);
    expect(maySnatch(rule, { ...winning, lastAt: 100, now: 159 })).toBe(false);
    expect(maySnatch(rule, { ...winning, lastAt: 100, now: 160 })).toBe(true);
    expect(snatchOpen(rule, { now: 400, playerLinks: 12, lastAt: 330 })).toBe(true);
  });

  it('never sends the spider back to a page it has seen', () => {
    expect(maySnatch(rule, { ...winning, visited: true })).toBe(false);
  });

  it('is Hard only', () => {
    expect(maySnatch(DIFFICULTIES.easy.snatch, winning)).toBe(false);
    expect(maySnatch(DIFFICULTIES.normal.snatch, winning)).toBe(false);
  });
});
