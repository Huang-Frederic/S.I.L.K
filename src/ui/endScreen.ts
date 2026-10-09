/**
 * End-of-race card: who won, and both paths side by side (hops, times, every
 * article visited, and why the spider chose each link).
 */
import type { Difficulty } from '../game/difficulty';
import type { PathStep, Race, Racer, RacerState } from '../game/race';
import { wikipediaUrl } from '../wiki/titles';
import { formatTime, h } from './dom';

export interface EndCardOptions {
  race: Race;
  difficulty: Difficulty;
  onRematch: () => void;
  onNewRace: () => void;
  /** Offered while the player can still finish after losing. */
  onKeepPlaying?: () => void;
  /** Offered while the spider is still crawling. */
  onWatchSpider?: () => void;
}

const REASON_TAGS: Record<string, { text: string; title: string }> = {
  target: { text: 'target', title: 'The target was linked from the previous page' },
  backlink: { text: 'backlink', title: 'This page was known to link to the target' },
  semantic: { text: 'ai', title: 'Closest in meaning to the target (sentence embeddings)' },
  lexical: { text: 'words', title: 'Best word match with the target (fallback ranking)' },
  'dead-end': { text: 'backtrack', title: 'Dead end: the spider climbed back' },
};

/** "by 12.3 s" style gap between two finishing times. */
function gap(ms: number): string {
  return ms < 1000 ? 'a split second' : formatTime(ms);
}

export function headline(race: Race): { title: string; tone: 'win' | 'lose' | 'neutral'; detail: string } {
  const { player, spider, winner } = race;
  if (winner === 'player') {
    const margin = spider.finishedAt !== null ? ` by ${gap(spider.finishedAt - player.finishedAt!)}` : '';
    const spiderNote = spider.retired ? ' The spider gave up.' : '';
    return { title: 'You win', tone: 'win', detail: `You reached the target first${margin}.${spiderNote}` };
  }
  if (winner === 'spider') {
    return {
      title: 'The spider wins',
      tone: 'lose',
      detail: player.finishedAt !== null ? `You arrived ${gap(player.finishedAt - spider.finishedAt!)} later.` : 'It reached the target before you.',
    };
  }
  if (player.retired && spider.retired) return { title: 'Nobody made it', tone: 'neutral', detail: 'Both of you gave up on this one.' };
  if (player.retired) return { title: 'You gave up', tone: 'neutral', detail: 'The spider is still crawling.' };
  return { title: 'Race over', tone: 'neutral', detail: '' };
}

export function createEndCard(options: EndCardOptions): HTMLElement {
  const { race, difficulty } = options;
  const top = headline(race);
  const actions: HTMLElement[] = [];
  if (options.onKeepPlaying) actions.push(h('button', { class: 'btn', text: 'Keep playing', on: { click: options.onKeepPlaying } }));
  if (options.onWatchSpider) actions.push(h('button', { class: 'btn btn-spider', text: 'Watch the spider finish', on: { click: options.onWatchSpider } }));
  actions.push(
    h('button', { class: 'btn btn-primary', text: 'Rematch', on: { click: options.onRematch } }),
    h('button', { class: 'btn btn-secondary', text: 'New race', on: { click: options.onNewRace } }),
  );

  return h(
    'div',
    { class: `end-card panel is-${top.tone}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'end-title' } },
    h(
      'header',
      { class: 'end-header' },
      h('p', { class: 'label', text: `Target · ${race.targetTitle}` }),
      h('h2', { class: 'end-title', text: top.title, attrs: { id: 'end-title' } }),
      top.detail ? h('p', { class: 'end-detail', text: top.detail }) : null,
    ),
    h('div', { class: 'end-columns' }, column(race, 'player', 'You'), column(race, 'spider', `Spider · ${difficulty.label}`)),
    h('div', { class: 'end-actions' }, ...actions),
  );
}

function column(race: Race, who: Racer, label: string): HTMLElement {
  const state = race.racer(who);
  const isWinner = race.winner === who;
  return h(
    'section',
    { class: `end-column is-${who} ${isWinner ? 'is-winner' : ''}` },
    h('h3', { class: 'end-who' }, h('span', { text: label }), isWinner ? h('span', { class: 'end-crown', text: 'winner' }) : null),
    h('p', { class: 'end-stats', text: summary(race, state) }),
    h('ol', { class: 'end-path' }, ...state.path.map((step, i) => pathItem(step, i, race.targetTitle))),
  );
}

function summary(race: Race, state: RacerState): string {
  const hops = `${state.hops} hop${state.hops === 1 ? '' : 's'}`;
  if (state.finishedAt !== null) return `${hops} · ${formatTime(state.finishedAt)}`;
  if (state.retired) return `Gave up after ${hops}`;
  return `${hops} so far · still going (${formatTime(race.clock.elapsed())})`;
}

function pathItem(step: PathStep, index: number, target: string): HTMLElement {
  const tag = step.via === 'back' ? REASON_TAGS['dead-end'] : step.note ? REASON_TAGS[step.note] : undefined;
  return h(
    'li',
    { class: `end-step ${step.title === target ? 'is-target' : ''} ${step.via === 'back' ? 'is-back' : ''}` },
    h('span', { class: 'end-step-time', text: index === 0 ? 'start' : formatTime(step.at) }),
    h('a', { class: 'end-step-title', attrs: { href: wikipediaUrl(step.title), target: '_blank', rel: 'noopener noreferrer' }, text: step.title }),
    tag ? h('span', { class: 'end-tag', text: tag.text, attrs: { title: tag.title } }) : null,
  );
}
