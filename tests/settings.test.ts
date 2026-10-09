import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
});

describe('settings', () => {
  it('counts Hard wins per browser', async () => {
    const { settings } = await import('../src/settings');
    expect(settings.hardWins).toBe(0);
    expect(settings.recordHardWin()).toBe(1);
    expect(settings.recordHardWin()).toBe(2);
    expect(localStorage.getItem('silk.hardWins')).toBe('2');
  });

  it('remembers Reduce motion and tells listeners', async () => {
    const { settings } = await import('../src/settings');
    const seen: boolean[] = [];
    settings.onChange(() => seen.push(settings.reduceMotion));
    settings.reduceMotion = true;
    expect(seen).toEqual([true]);
    expect(localStorage.getItem('silk.reduceMotion')).toBe('1');
    expect(settings.duration(1)).toBeLessThan(1);
    settings.reduceMotion = false;
    expect(settings.duration(1)).toBe(1);
  });

  it('plays in English until told otherwise, and remembers the language', async () => {
    const { settings } = await import('../src/settings');
    expect(settings.lang).toBe('en');
    settings.lang = 'fr';
    expect(localStorage.getItem('silk.lang')).toBe('fr');
    expect(settings.lang).toBe('fr');
    localStorage.setItem('silk.lang', 'klingon');
    expect(settings.lang).toBe('en');
  });

  it('works without storage (private mode, blocked site data)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { settings } = await import('../src/settings');
    expect(settings.hardWins).toBe(0);
    expect(() => settings.recordHardWin()).not.toThrow();
    expect(() => (settings.reduceMotion = true)).not.toThrow();
    expect(settings.reduceMotion).toBe(true);
  });

  it('ignores a corrupted counter', async () => {
    localStorage.setItem('silk.hardWins', 'lots');
    const { settings } = await import('../src/settings');
    expect(settings.hardWins).toBe(0);
  });
});
