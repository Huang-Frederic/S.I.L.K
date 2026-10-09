/**
 * Finish screen (mockup "Finish screen"): the verdict, four stat cards, both
 * paths side by side, and Rematch / New pair / Copy both paths.
 *
 * Losing earns a roast built from the race's real numbers; beating the
 * spider on Hard earns a big "IMPOSSIBLE. (screenshot this.)".
 */
import { REPO_URL, GAME_URL } from '../config';
import { GIVE_UP_ROASTS, pickRoast } from '../game/comedy';
import type { PathStep, Race } from '../game/race';
import { OPEN_GROUND, SpiderRig } from '../spider/rig';
import { wikipediaUrl } from '../wiki/titles';
import { formatClock, h } from './dom';
import type { RaceResult } from './raceScreen';

export type OutcomeKind = 'win' | 'impossible' | 'lose' | 'gave-up' | 'nobody';

export interface Outcome {
  kind: OutcomeKind;
  title: string;
  /** Second line of the headline ("(screenshot this.)"). */
  tagline?: string;
  detail: string;
  /** `spider.status = …` */
  status: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What happened, in words. `random` picks the roast line. */
export function outcome(result: RaceResult, random: () => number = Math.random): Outcome {
  const { race, difficulty } = result;
  const { player, spider } = race;
  if (race.winner === 'player') {
    const diff = spider.hops - player.hops;
    const margin =
      diff > 0 ? `You beat the spider by ${plural(diff, 'hop')}.` : diff === 0 ? 'You beat the spider in as many hops.' : `You beat the spider, even with ${plural(-diff, 'more hop')}.`;
    const spiderNote = spider.retired ? ' The spider gave up.' : result.spiderOneAway ? ' It was one link away from the target.' : ' It was still crawling.';
    if (difficulty.id === 'hard') {
      return {
        kind: 'impossible',
        title: 'IMPOSSIBLE.',
        tagline: '(screenshot this.)',
        detail: `${margin}${spiderNote} Hard mode wins in this browser: ${result.hardWins}.`,
        status: 'spider.status = deceased',
      };
    }
    return { kind: 'win', title: 'You win.', detail: `${margin}${spiderNote}`, status: 'spider.status = defeated' };
  }
  if (result.gaveUp) {
    return { kind: 'gave-up', title: 'You gave up.', detail: GIVE_UP_ROASTS[Math.floor(random() * GIVE_UP_ROASTS.length)], status: 'spider.status = smug' };
  }
  if (race.winner === 'spider') {
    const roast = pickRoast(
      { wordsEaten: result.wordsEaten, spiderHops: spider.hops, difficulty: difficulty.id, decoysClicked: result.decoysClicked, snatched: result.snatched },
      random,
    );
    return { kind: 'lose', title: 'Spider wins.', detail: roast, status: 'spider.status = victorious' };
  }
  return { kind: 'nobody', title: 'Nobody made it.', detail: 'Both of you gave up on this one.', status: 'spider.status = stuck' };
}

/** Plain-text summary of both paths (Copy both paths). */
export function pathsText(result: RaceResult, verdict: Outcome): string {
  const { race } = result;
  const line = (who: string, state: Race['player']) =>
    `${who} (${plural(state.hops, 'hop')}${state.arrivedAt !== null ? `, ${formatClock(state.arrivedAt)}` : ''}): ${state.path.map((s) => (s.via === 'swap' ? `[swap] ${s.title}` : s.title)).join(' → ')}`;
  return [
    `S.I.L.K · ${race.startTitle} → ${race.targetTitle} · ${result.difficulty.label}`,
    `${verdict.title}${verdict.tagline ? ` ${verdict.tagline}` : ''}`,
    line('You', race.player),
    line('Spider', race.spider),
    GAME_URL,
  ].join('\n');
}

export interface FinishScreenOptions {
  result: RaceResult;
  onRematch: () => void;
  onNewPair: () => void;
}

export function createFinishScreen(options: FinishScreenOptions): HTMLElement {
  const { result } = options;
  const { race } = result;
  const verdict = outcome(result);
  const playerWon = race.winner === 'player';

  const timeCard = playerWon
    ? card('Your time', formatClock(race.player.arrivedAt ?? 0), 'is-time')
    : race.spider.arrivedAt !== null
      ? card('Spider time', formatClock(race.spider.arrivedAt), 'is-spider')
      : card('Race time', formatClock(race.clock.elapsed()), 'is-time');

  const copyBtn = h('button', { class: 'btn-link', text: 'Copy both paths', attrs: { type: 'button' } });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pathsText(result, verdict));
      copyBtn.textContent = 'Copied';
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => (copyBtn.textContent = 'Copy both paths'), 1800);
  });

  const rematch = h('button', { class: 'btn btn-primary', text: 'Rematch', attrs: { type: 'button' }, on: { click: options.onRematch } });
  const element = h(
    'main',
    { class: `screen screen-finish is-${verdict.kind}` },
    h(
      'div',
      { class: 'finish-inner' },
      h(
        'header',
        { class: 'finish-head' },
        h(
          'div',
          { class: 'finish-verdict' },
          h('p', { class: 'kicker kicker-muted', text: `Race complete · ${race.startTitle} → ${race.targetTitle} · ${result.difficulty.label}` }),
          h('h1', { class: 'finish-title', text: verdict.title, attrs: { id: 'finish-title' } }),
          verdict.tagline ? h('p', { class: 'finish-tagline', text: verdict.tagline }) : null,
          h('p', { class: 'finish-detail', text: verdict.detail }),
        ),
        h('figure', { class: 'finish-spider' }, spiderPortrait(playerWon), h('figcaption', { text: verdict.status })),
      ),
      h(
        'section',
        { class: 'finish-stats', attrs: { 'aria-label': 'Stats' } },
        timeCard,
        card('Your hops', String(race.player.hops), 'is-player'),
        card('Spider hops', String(race.spider.hops), 'is-spider'),
        card('Words eaten', result.wordsEaten.toLocaleString('en-US'), 'is-words'),
      ),
      h('section', { class: 'finish-paths' }, pathCard('Your path', race.player.path, 'is-player', race.targetTitle), pathCard("Spider's path", race.spider.path, 'is-spider', race.targetTitle)),
      h(
        'div',
        { class: 'finish-actions' },
        rematch,
        h('button', { class: 'btn btn-ghost', text: 'New pair', attrs: { type: 'button' }, on: { click: options.onNewPair } }),
        copyBtn,
      ),
      h(
        'p',
        { class: 'finish-foot' },
        'Article text from Wikipedia, CC BY-SA 4.0. ',
        h('a', { text: 'Source code', attrs: { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' } }),
      ),
    ),
  );
  element.setAttribute('aria-labelledby', 'finish-title');
  queueMicrotask(() => rematch.focus({ preventScroll: true }));
  return element;
}

function card(label: string, value: string, className: string): HTMLElement {
  return h('div', { class: `stat-card ${className}` }, h('span', { class: 'stat-label', text: label }), h('strong', { class: 'stat-value', text: value }));
}

const NOTE_TAGS: Record<string, string> = {
  snatch: 'snatched',
  'dead-end': 'backtrack',
  swap: 'swapped',
};

function pathCard(title: string, path: PathStep[], className: string, target: string): HTMLElement {
  return h(
    'section',
    { class: `path-card ${className}` },
    h('h2', { class: 'path-title', text: title }),
    h(
      'ol',
      { class: 'path-list' },
      ...path.map((step) => {
        const tag = step.via === 'swap' ? 'swapped' : step.via === 'back' ? 'back' : step.note ? NOTE_TAGS[step.note] : undefined;
        return h(
          'li',
          { class: `path-step ${step.title === target ? 'is-target' : ''}` },
          h('a', { text: step.title, attrs: { href: wikipediaUrl(step.title), target: '_blank', rel: 'noopener noreferrer' } }),
          tag ? h('span', { class: 'path-tag', text: tag }) : null,
        );
      }),
    ),
  );
}

/** The spider, dancing (it won) or curled up (it lost). */
function spiderPortrait(defeated: boolean): HTMLCanvasElement {
  const size = 150;
  const canvas = h('canvas', { class: 'finish-portrait', attrs: { width: String(size * 2), height: String(size * 2), 'aria-hidden': 'true' } });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const rig = new SpiderRig(0.62);
  rig.x = size / 2;
  rig.y = size / 2;
  rig.visible = true;
  rig.plantAll(OPEN_GROUND);
  // Defeated: legs folded tight around the body, eye off (as in the mockup).
  rig.pose = defeated ? 'grab' : 'dance';
  if (defeated) {
    rig.eyeOpen = 0;
    rig.grabBox = { left: size / 2 - 16, right: size / 2 + 16, top: size / 2 - 30, bottom: size / 2 + 30 };
  }
  let last = performance.now();
  const born = last;
  let shown = false;
  const frame = (now: number) => {
    // Runs while the canvas is on screen.
    if (canvas.isConnected) shown = true;
    else if (shown || now - born > 3000) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    rig.update(dt, OPEN_GROUND);
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, size, size);
    rig.draw(ctx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return canvas;
}
