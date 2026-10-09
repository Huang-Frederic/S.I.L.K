import { describe, expect, it } from 'vitest';
import { pickRoast, roastLines, TAUNT_GAP, TauntPicker, TAUNTS } from '../src/game/comedy';
import { DIFFICULTIES } from '../src/game/difficulty';

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

  it('keeps every line short and lowercase', () => {
    for (const lines of Object.values(TAUNTS)) {
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(40);
        expect(line).toBe(line.toLowerCase());
      }
    }
  });
});

describe('roasts', () => {
  const facts = { wordsEaten: 2318, spiderHops: 7, difficulty: 'hard' as const, penaltyMs: 0, photoFinish: false };

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
});

describe('difficulty table', () => {
  it('matches the design: Easy never attacks, Normal has three attacks, Hard has everything', () => {
    expect(DIFFICULTIES.easy.attacks).toEqual([]);
    expect(DIFFICULTIES.easy.snatch).toBeNull();
    expect(DIFFICULTIES.easy.rage).toBe('never');
    expect(DIFFICULTIES.normal.attacks.sort()).toEqual(['bombard', 'laser', 'web']);
    expect(DIFFICULTIES.normal.cooldown[0]).toBeGreaterThanOrEqual(20);
    expect(DIFFICULTIES.normal.cooldown[1]).toBeLessThanOrEqual(30);
    expect(DIFFICULTIES.hard.attacks.length).toBe(7);
    expect(DIFFICULTIES.hard.cooldown).toEqual([4, 8]);
    expect(DIFFICULTIES.hard.rage).toBe('always');
    expect(DIFFICULTIES.hard.snatch).toEqual({ radius: 120, cooldown: 8 });
    expect(DIFFICULTIES.hard.blackoutSeconds).toBe(6);
    expect(DIFFICULTIES.hard.hatchSeconds).toBe(3);
    expect(DIFFICULTIES.hard.harassSeconds).toBe(2);
    expect(DIFFICULTIES.hard.maxDecoys).toBe(3);
    expect(DIFFICULTIES.hard.decoyPenaltyMs).toBe(15_000);
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

  it('gets around on foot, smashing text, and keeps web zips for very far links', () => {
    for (const d of Object.values(DIFFICULTIES)) {
      expect(d.zipBeyond).toBeGreaterThanOrEqual(3000);
      expect(d.mischief).toBeGreaterThan(0.4);
    }
  });
});
