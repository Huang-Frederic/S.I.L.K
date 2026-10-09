import { beforeEach, describe, expect, it } from 'vitest';
import { RaceClock } from '../src/game/clock';
import { DIFFICULTIES, type DifficultyId } from '../src/game/difficulty';
import { Race } from '../src/game/race';
import { setLang } from '../src/i18n';
import { outcome, pathsText } from '../src/ui/finishScreen';
import type { RaceResult } from '../src/ui/raceScreen';

function setup() {
  let now = 0;
  const clock = new RaceClock(() => now);
  const race = new Race('Moth Orchard', 'Tidewatch Observatory', clock);
  clock.start();
  return { race, clock, advance: (ms: number) => (now += ms) };
}

function result(race: Race, difficulty: DifficultyId, extra: Partial<RaceResult> = {}): RaceResult {
  return {
    race,
    difficulty: DIFFICULTIES[difficulty],
    pair: {} as RaceResult['pair'],
    wordsEaten: 2318,
    spiderOneAway: false,
    gaveUp: false,
    decoysClicked: 0,
    snatched: false,
    hardWins: 0,
    ...extra,
  };
}

describe('RaceClock', () => {
  it('pauses and resumes', () => {
    let now = 1000;
    const clock = new RaceClock(() => now);
    clock.start();
    now += 500;
    clock.pause();
    now += 10_000;
    expect(clock.elapsed()).toBe(500);
    clock.start();
    now += 250;
    expect(clock.elapsed()).toBe(750);
    expect(clock.running).toBe(true);
  });
});

describe('Race', () => {
  it('records paths, hops and times', () => {
    const { race, advance } = setup();
    advance(1200);
    expect(race.move('player', 'Silk')).toBe(false);
    advance(800);
    race.move('player', 'Moth Orchard', 'back');
    expect(race.player.hops).toBe(2);
    expect(race.player.path).toEqual([
      { title: 'Moth Orchard', at: 0, via: 'start' },
      { title: 'Silk', at: 1200, via: 'link' },
      { title: 'Moth Orchard', at: 2000, via: 'back' },
    ]);
    expect(race.current('player')).toBe('Moth Orchard');
  });

  it('crowns the first racer to reach the target', () => {
    const { race, advance } = setup();
    advance(3000);
    race.move('spider', 'Lantern Festival', 'link', 'semantic');
    advance(3000);
    expect(race.move('spider', 'Tidewatch Observatory', 'link', 'target')).toBe(true);
    expect(race.winner).toBe('spider');
    expect(race.spider.arrivedAt).toBe(6000);
    expect(race.spider.path[1].note).toBe('semantic');
    // The player can still finish, but does not take the win.
    advance(2000);
    expect(race.move('player', 'Tidewatch Observatory')).toBe(true);
    expect(race.winner).toBe('spider');
    expect(race.over).toBe(true);
    // Nobody moves after finishing.
    expect(race.move('player', 'Silk')).toBe(false);
    expect(race.player.hops).toBe(1);
  });

  it('lets a racer retire without awarding the win', () => {
    const { race } = setup();
    race.retire('spider');
    expect(race.isDone('spider')).toBe(true);
    expect(race.winner).toBeNull();
    expect(race.move('spider', 'Silk')).toBe(false);
    race.move('player', 'Tidewatch Observatory');
    expect(race.winner).toBe('player');
  });

  it('swaps panes without counting a hop', () => {
    const { race, advance } = setup();
    advance(500);
    race.move('player', 'Silk');
    advance(500);
    race.move('spider', 'Lantern Festival', 'link', 'semantic');
    advance(500);
    // The spider snatches the player's next link; the player inherits the spider's page.
    race.move('spider', 'Copper Lighthouse', 'link', 'snatch');
    race.teleport('player', 'Lantern Festival', 'swap');
    expect(race.player.hops).toBe(1);
    expect(race.current('player')).toBe('Lantern Festival');
    expect(race.player.path.at(-1)).toMatchObject({ via: 'swap', title: 'Lantern Festival' });
    expect(race.spider.hops).toBe(2);
  });
});

describe('finish screen verdict', () => {
  beforeEach(() => setLang('en'));

  it('describes a win with the hop margin', () => {
    const { race, advance } = setup();
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) race.move('spider', title);
    for (const title of ['Silk', 'Silk Road', 'Printing']) race.move('player', title);
    advance(178_000);
    race.move('player', 'Tidewatch Observatory');
    const verdict = outcome(result(race, 'normal', { spiderOneAway: true }));
    expect(verdict).toMatchObject({ kind: 'win', title: 'You win.' });
    expect(verdict.detail).toBe('You beat the spider by 3 hops. It was one link away from the target.');
  });

  it('shouts IMPOSSIBLE on a Hard win', () => {
    const { race } = setup();
    race.move('player', 'Tidewatch Observatory');
    const verdict = outcome(result(race, 'hard', { hardWins: 1 }));
    expect(verdict.kind).toBe('impossible');
    expect(verdict.title).toBe('IMPOSSIBLE.');
    expect(verdict.tagline).toBe('(screenshot this.)');
    expect(verdict.detail).toContain('Hard mode wins in this browser: 1.');
  });

  it('roasts the loser with real numbers', () => {
    const { race } = setup();
    race.move('spider', 'Tidewatch Observatory');
    const verdict = outcome(result(race, 'normal'), () => 0);
    expect(verdict).toMatchObject({ kind: 'lose', title: 'Spider wins.' });
    expect(verdict.detail).toBe('The spider ate 2,318 words and your dignity.');
  });

  it('teases a player who fell for a fake link or got robbed', () => {
    const { race } = setup();
    race.move('spider', 'Tidewatch Observatory');
    const lines = new Set(Array.from({ length: 40 }, (_, i) => outcome(result(race, 'hard', { decoysClicked: 1, snatched: true }), () => i / 40).detail));
    expect(lines).toContain('You clicked a fake link. The babies say thanks.');
    expect(lines).toContain('It stole your best link. And your race.');
  });

  it('handles giving up and nobody finishing', () => {
    const quit = setup();
    quit.race.retire('player');
    expect(outcome(result(quit.race, 'easy', { gaveUp: true })).kind).toBe('gave-up');
    quit.race.retire('spider');
    expect(outcome(result(quit.race, 'easy')).kind).toBe('nobody');
  });

  it('copies both paths as text', () => {
    const { race, advance } = setup();
    advance(65_000);
    race.move('player', 'Tidewatch Observatory');
    const text = pathsText(result(race, 'normal'), outcome(result(race, 'normal')));
    expect(text).toContain('S.I.L.K · Moth Orchard → Tidewatch Observatory · Normal');
    expect(text).toContain('You (1 hop, 01:05): Moth Orchard → Tidewatch Observatory');
    expect(text).toContain('Spider (0 hops): Moth Orchard');
  });

  it('says it all in French in French', () => {
    setLang('fr');
    const { race, advance } = setup();
    for (const title of ['A', 'B', 'C']) race.move('spider', title);
    advance(65_000);
    race.move('player', 'Tidewatch Observatory');
    const verdict = outcome(result(race, 'normal'));
    expect(verdict).toMatchObject({ kind: 'win', title: 'Tu as gagné.', status: 'spider.status = vaincue' });
    expect(verdict.detail).toBe('Tu bats l’araignée de 2 sauts. Elle rampait encore.');
    const text = pathsText(result(race, 'normal'), verdict);
    expect(text).toContain('Toi (1 saut, 01:05): Moth Orchard → Tidewatch Observatory');
    expect(text).toContain('Araignée (3 sauts)');
    expect(outcome(result(race, 'hard', { hardWins: 2 })).tagline).toBe('(fais une capture.)');
  });
});
