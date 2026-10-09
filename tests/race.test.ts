import { describe, expect, it } from 'vitest';
import { RaceClock } from '../src/game/clock';
import { Race } from '../src/game/race';
import { headline } from '../src/ui/endScreen';

function setup() {
  let now = 0;
  const clock = new RaceClock(() => now);
  const race = new Race('Moth Orchard', 'Tidewatch Observatory', clock);
  clock.start();
  return { race, clock, advance: (ms: number) => (now += ms) };
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
    expect(race.spider.finishedAt).toBe(6000);
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
});

describe('end card headline', () => {
  it('describes each outcome', () => {
    const win = setup();
    win.advance(5000);
    win.race.move('player', 'Tidewatch Observatory');
    win.advance(7000);
    win.race.move('spider', 'Tidewatch Observatory');
    expect(headline(win.race)).toMatchObject({ title: 'You win', tone: 'win', detail: 'You reached the target first by 0:07.0.' });

    const lose = setup();
    lose.advance(4000);
    lose.race.move('spider', 'Tidewatch Observatory');
    expect(headline(lose.race)).toMatchObject({ title: 'The spider wins', tone: 'lose' });
    lose.advance(400);
    lose.race.move('player', 'Tidewatch Observatory');
    expect(headline(lose.race).detail).toBe('You arrived a split second later.');

    const quit = setup();
    quit.race.retire('player');
    expect(headline(quit.race).title).toBe('You gave up');
    quit.race.retire('spider');
    expect(headline(quit.race).title).toBe('Nobody made it');

    const stuck = setup();
    stuck.race.retire('spider');
    stuck.race.move('player', 'Tidewatch Observatory');
    expect(headline(stuck.race).detail).toContain('The spider gave up.');
  });
});
