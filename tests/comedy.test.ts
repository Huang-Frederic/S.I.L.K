import { beforeEach, describe, expect, it } from 'vitest';
import { pickRoast, roastLines, TAUNT_GAP, TauntPicker, taunts } from '../src/game/comedy';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../src/game/difficulty';
import { LANGS, setLang } from '../src/i18n';

beforeEach(() => setLang('en'));

describe('taunts', () => {
  it('says at most one line every few seconds', () => {
    const picker = new TauntPicker(1, TAUNT_GAP, () => 0);
    expect(picker.pick('snatch', 0)).toBe('mine now.');
    expect(picker.pick('laser', 2)).toBeNull();
    expect(picker.pick('laser', 5.9)).toBeNull();
    expect(picker.pick('laser', 6.1)).toBe('pew.');
  });

  it('lets key moments through the rate limit', () => {
    const picker = new TauntPicker(1, TAUNT_GAP, () => 0);
    picker.pick('snatch', 0);
    expect(picker.pick('spider-wins', 1, true)).toBe('gg.');
  });

  it('is less talkative on easier levels', () => {
    const quiet = new TauntPicker(DIFFICULTIES.easy.taunts, TAUNT_GAP, () => 0.5);
    expect(quiet.pick('hop', 0)).toBeNull();
    const loud = new TauntPicker(DIFFICULTIES.hard.taunts, TAUNT_GAP, () => 0.5);
    expect(loud.pick('hop', 0)).not.toBeNull();
  });

  it('never repeats the same line twice in a row', () => {
    const picker = new TauntPicker(1, 0, () => 0);
    const first = picker.pick('snatch', 0);
    const second = picker.pick('snatch', 1);
    expect(second).not.toBe(first);
  });

  it('keeps every line short and lowercase, in every language', () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const lines of Object.values(taunts())) {
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(40);
          expect(line).toBe(line.toLowerCase());
        }
      }
    }
  });

  it('speaks French in French', () => {
    setLang('fr');
    const picker = new TauntPicker(1, TAUNT_GAP, () => 0);
    expect(picker.pick('snatch', 0)).toBe('à moi.');
    expect(picker.pick('spider-wins', 1, true)).toBe('gg.');
  });
});

describe('roasts', () => {
  const facts = { wordsEaten: 2318, spiderHops: 7, difficulty: 'hard' as const, decoysClicked: 0, snatched: false };

  it('uses the real numbers of the race', () => {
    const lines = roastLines(facts);
    expect(lines).toContain('The spider ate 2,318 words and your dignity.');
    expect(lines).toContain('8 legs, 1 eye, 0 mercy.');
    expect(lines).toContain('Maybe try Easy. Or don’t.');
    expect(lines).toContain('7 hops. Zero hesitation.');
  });

  it('picks one at random', () => {
    const lines = roastLines(facts);
    expect(pickRoast(facts, () => 0)).toBe(lines[0]);
    expect(pickRoast(facts, () => 0.999)).toBe(lines[lines.length - 1]);
  });

  it('teases an Easy loss', () => {
    expect(roastLines({ ...facts, difficulty: 'easy' })).toContain('Lost on Easy. The spider is telling everyone.');
  });

  it('roasts in French too, with French numbers and plurals', () => {
    setLang('fr');
    const lines = roastLines(facts);
    expect(lines).toContain(`L’araignée a dévoré ${(2318).toLocaleString('fr-FR')} mots et ta dignité.`);
    expect(lines).toContain('7 sauts. Zéro hésitation.');
    expect(roastLines({ ...facts, spiderHops: 1, wordsEaten: 1 })).toContain('1 saut. Zéro hésitation.');
    expect(roastLines({ ...facts, wordsEaten: 1 })).toContain('L’araignée a dévoré 1 mot et ta dignité.');
  });

  it('never mentions time penalties (there are none)', () => {
    for (const line of roastLines({ ...facts, decoysClicked: 2, snatched: true })) expect(line).not.toMatch(/penalty|\+\d+ s/);
  });
});

describe('difficulty table', () => {
  it('matches the design: Easy never attacks, Normal has three attacks, Hard has five', () => {
    expect(DIFFICULTIES.easy.attacks).toEqual([]);
    expect(DIFFICULTIES.easy.snatch).toBeNull();
    expect(DIFFICULTIES.easy.rage).toBe('never');
    expect([...DIFFICULTIES.normal.attacks].sort()).toEqual(['bombard', 'laser', 'web']);
    expect(DIFFICULTIES.normal.snatch).toBeNull();
    expect(DIFFICULTIES.normal.cooldown[0]).toBeGreaterThanOrEqual(20);
    expect(DIFFICULTIES.normal.cooldown[1]).toBeLessThanOrEqual(30);
    expect([...DIFFICULTIES.hard.attacks].sort()).toEqual(['bombard', 'decoy', 'harass', 'laser', 'web']);
    expect(DIFFICULTIES.hard.cooldown).toEqual([4, 8]);
    expect(DIFFICULTIES.hard.rage).toBe('always');
    // Link snatch: never on the first 3 links, then at most one a minute.
    expect(DIFFICULTIES.hard.snatch).toEqual({ safeHops: 3, cooldown: 60 });
    expect(DIFFICULTIES.hard.harassSeconds).toBe(2);
    expect(DIFFICULTIES.hard.harassGap).toBeGreaterThanOrEqual(40);
    expect(DIFFICULTIES.hard.maxDecoys).toBe(3);
    expect(DIFFICULTIES.hard.decoyMinis).toBeGreaterThan(0);
    expect(DIFFICULTIES.hard.laserFan).toBeGreaterThan(DIFFICULTIES.normal.laserFan);
  });

  it('gets faster with each level', () => {
    expect(DIFFICULTIES.easy.thinkMs).toBeGreaterThan(DIFFICULTIES.normal.thinkMs);
    expect(DIFFICULTIES.normal.thinkMs).toBeGreaterThan(DIFFICULTIES.hard.thinkMs);
    expect(DIFFICULTIES.easy.walkSpeed).toBeLessThan(DIFFICULTIES.normal.walkSpeed);
    expect(DIFFICULTIES.normal.walkSpeed).toBeLessThan(DIFFICULTIES.hard.walkSpeed);
    const run = (id: 'easy' | 'normal' | 'hard') => DIFFICULTIES[id].walkSpeed * DIFFICULTIES[id].sprint;
    expect(run('easy')).toBeLessThan(run('normal'));
    expect(run('normal')).toBeLessThan(run('hard'));
  });

  it('walks and bounds on long trips, zips some short ones, and tears up what it grips', () => {
    for (const d of Object.values(DIFFICULTIES)) {
      expect(d.zipChance).toBeGreaterThan(0);
      expect(d.zipChance).toBeLessThan(0.5);
      expect(d.leaps).toBeGreaterThan(0);
      expect(d.mischief).toBeGreaterThan(0.4);
      expect(d.crush).toBeGreaterThan(0);
    }
  });

  it('runs on Normal, between the old Normal and Hard; Hard fumbles and wrecks more', () => {
    expect(DEFAULT_DIFFICULTY).toBe('normal');
    expect(DIFFICULTIES.normal.walkSpeed).toBeGreaterThan(125);
    expect(DIFFICULTIES.normal.walkSpeed).toBeLessThan(DIFFICULTIES.hard.walkSpeed);
    expect(DIFFICULTIES.hard.thinkMs).toBeGreaterThanOrEqual(1000);
    expect(DIFFICULTIES.hard.hesitate).toBeGreaterThan(DIFFICULTIES.normal.hesitate);
    expect(DIFFICULTIES.hard.crush).toBeGreaterThan(DIFFICULTIES.normal.crush);
    expect(DIFFICULTIES.hard.mischief).toBeGreaterThan(DIFFICULTIES.normal.mischief);
  });
});
