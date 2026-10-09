/**
 * Finish screen (mockup "Finish screen"): the verdict, four stat cards, both
 * paths side by side, and Rematch / New pair / Copy both paths.
 *
 * Losing earns a roast built from the race's real numbers; beating the
 * spider on Hard earns a big "IMPOSSIBLE. (screenshot this.)".
 */
import { REPO_URL, GAME_URL } from '../config';
import { giveUpRoasts, pickRoast } from '../game/comedy';
import type { PathStep, Race } from '../game/race';
import { lang, t } from '../i18n';
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

/** What happened, in words. `random` picks the roast line. */
export function outcome(result: RaceResult, random: () => number = Math.random): Outcome {
  const { race, difficulty } = result;
  const { player, spider } = race;
  const text = t().finish;
  const status = (kind: OutcomeKind) => `spider.status = ${text.status[kind]}`;
  if (race.winner === 'player') {
    const diff = spider.hops - player.hops;
    const margin = diff > 0 ? text.beatBy(diff) : diff === 0 ? text.beatEven : text.beatDespite(-diff);
    const spiderNote = spider.retired ? text.spiderRetired : result.spiderOneAway ? text.spiderOneAway : text.spiderCrawling;
    if (difficulty.id === 'hard') {
      return {
        kind: 'impossible',
        title: text.impossible,
        tagline: text.screenshot,
        detail: `${margin}${spiderNote}${text.hardWins(result.hardWins)}`,
        status: status('impossible'),
      };
    }
    return { kind: 'win', title: text.win, detail: `${margin}${spiderNote}`, status: status('win') };
  }
  if (result.gaveUp) {
    const lines = giveUpRoasts();
    return { kind: 'gave-up', title: text.gaveUp, detail: lines[Math.floor(random() * lines.length)], status: status('gave-up') };
  }
  if (race.winner === 'spider') {
    const roast = pickRoast(
      { wordsEaten: result.wordsEaten, spiderHops: spider.hops, difficulty: difficulty.id, decoysClicked: result.decoysClicked, snatched: result.snatched },
      random,
    );
    return { kind: 'lose', title: text.lose, detail: roast, status: status('lose') };
  }
  return { kind: 'nobody', title: text.nobody, detail: text.nobodyDetail, status: status('nobody') };
}

/** Plain-text summary of both paths (Copy both paths). */
export function pathsText(result: RaceResult, verdict: Outcome): string {
  const { race } = result;
  const text = t().finish;
  const line = (who: string, state: Race['player']) =>
    `${who} (${text.hops(state.hops)}${state.arrivedAt !== null ? `, ${formatClock(state.arrivedAt)}` : ''}): ${state.path.map((s) => (s.via === 'swap' ? `[swap] ${s.title}` : s.title)).join(' → ')}`;
  return [
    `S.I.L.K · ${race.startTitle} → ${race.targetTitle} · ${t().difficulties[result.difficulty.id].label}`,
    `${verdict.title}${verdict.tagline ? ` ${verdict.tagline}` : ''}`,
    line(text.you, race.player),
    line(text.spider, race.spider),
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
  const text = t().finish;

  const timeCard = playerWon
    ? card(text.yourTime, formatClock(race.player.arrivedAt ?? 0), 'is-time')
    : race.spider.arrivedAt !== null
      ? card(text.spiderTime, formatClock(race.spider.arrivedAt), 'is-spider')
      : card(text.raceTime, formatClock(race.clock.elapsed()), 'is-time');

  const copyBtn = h('button', { class: 'btn-link', text: text.copy, attrs: { type: 'button' } });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pathsText(result, verdict));
      copyBtn.textContent = text.copied;
    } catch {
      copyBtn.textContent = text.copyFailed;
    }
    setTimeout(() => (copyBtn.textContent = text.copy), 1800);
  });

  const rematch = h('button', { class: 'btn btn-primary', text: text.rematch, attrs: { type: 'button' }, on: { click: options.onRematch } });
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
          h('p', { class: 'kicker kicker-muted', text: `${text.complete} · ${race.startTitle} → ${race.targetTitle} · ${t().difficulties[result.difficulty.id].label}` }),
          h('h1', { class: `finish-title ${verdict.title.length > 14 ? 'is-long' : ''}`, text: verdict.title, attrs: { id: 'finish-title' } }),
          verdict.tagline ? h('p', { class: 'finish-tagline', text: verdict.tagline }) : null,
          h('p', { class: 'finish-detail', text: verdict.detail }),
        ),
        h('figure', { class: 'finish-spider' }, spiderPortrait(playerWon), h('figcaption', { text: verdict.status })),
      ),
      h(
        'section',
        { class: 'finish-stats', attrs: { 'aria-label': text.stats } },
        timeCard,
        card(text.yourHops, String(race.player.hops), 'is-player'),
        card(text.spiderHops, String(race.spider.hops), 'is-spider'),
        card(text.wordsEaten, result.wordsEaten.toLocaleString(t().numberLocale), 'is-words'),
      ),
      h('section', { class: 'finish-paths' }, pathCard(text.yourPath, race.player.path, 'is-player', race.targetTitle), pathCard(text.spiderPath, race.spider.path, 'is-spider', race.targetTitle)),
      h(
        'div',
        { class: 'finish-actions' },
        rematch,
        h('button', { class: 'btn btn-ghost', text: text.newPair, attrs: { type: 'button' }, on: { click: options.onNewPair } }),
        copyBtn,
      ),
      h(
        'p',
        { class: 'finish-foot' },
        text.foot,
        h('a', { text: text.source, attrs: { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' } }),
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

function pathCard(title: string, path: PathStep[], className: string, target: string): HTMLElement {
  return h(
    'section',
    { class: `path-card ${className}` },
    h('h2', { class: 'path-title', text: title }),
    h(
      'ol',
      { class: 'path-list' },
      ...path.map((step) => {
        const tags = t().finish.tags;
        const tag = step.via === 'swap' ? tags.swap : step.via === 'back' ? tags.back : step.note ? tags[step.note] : undefined;
        return h(
          'li',
          { class: `path-step ${step.title === target ? 'is-target' : ''}` },
          h('a', { text: step.title, attrs: { href: wikipediaUrl(step.title, lang()), target: '_blank', rel: 'noopener noreferrer' } }),
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
