/**
 * Title screen (mockup "Title screen"): the pitch, the race form (start and
 * target pages with autocomplete and dice, difficulty), a live demo of the
 * spider, settings (Reduce motion) and the local Hard-mode win counter, then
 * "How it works" below the fold.
 */
import { GAME_FULL_NAME, REPO_URL } from '../config';
import { DIFFICULTIES, type DifficultyId } from '../game/difficulty';
import { pickRandomStart, pickRandomTarget, validatePair, type ValidatedPair } from '../game/pairs';
import { settings } from '../settings';
import type { WikiClient } from '../wiki/client';
import { Autocomplete } from './autocomplete';
import { TitleDemo } from './demo';
import { h } from './dom';
import { icon } from './icons';
import { illustration, type IllustrationKind } from './illustrations';
import { logoMark } from './logo';

export interface TitleChoice {
  pair: ValidatedPair;
  difficulty: DifficultyId;
}

export interface TitleScreenOptions {
  client: WikiClient;
  initialStart?: string;
  initialTarget?: string;
  initialDifficulty: DifficultyId;
  onStart: (choice: TitleChoice) => void;
}

export interface TitleScreen {
  element: HTMLElement;
  /** Starts the animations once the element is in the document. */
  mount(): void;
  destroy(): void;
}

export function createTitleScreen(options: TitleScreenOptions): TitleScreen {
  const { client } = options;
  const startField = titleField('start', 'Start page', 'e.g. Silk', client);
  const targetField = titleField('target', 'Target page', 'e.g. Pixel art', client);
  startField.input.value = options.initialStart ?? '';
  targetField.input.value = options.initialTarget ?? '';

  const difficulty = difficultyPicker(options.initialDifficulty);
  const generalError = h('p', { class: 'field-error', attrs: { role: 'alert' } });
  generalError.hidden = true;
  const startBtn = h('button', { class: 'btn btn-primary btn-start', text: 'Start race', attrs: { type: 'submit' } });
  const randomPairBtn = h('button', { class: 'btn btn-ghost btn-random', attrs: { type: 'button' } }, icon('dice', 18), 'Random pair');

  const setBusy = (busy: boolean) => {
    for (const el of [randomPairBtn, startBtn, startField.dice, targetField.dice]) el.disabled = busy;
    startBtn.textContent = busy ? 'Checking…' : 'Start race';
  };

  const rollStart = async () => {
    startField.dice.disabled = true;
    startField.input.value = '';
    startField.input.placeholder = 'Rolling a random article…';
    try {
      startField.input.value = await pickRandomStart(client, [targetField.input.value]);
      startField.setError();
    } catch {
      startField.setError('Could not reach Wikipedia for a random article. Type one instead.');
    } finally {
      startField.dice.disabled = false;
      startField.input.placeholder = 'e.g. Silk';
    }
  };
  const rollTarget = () => {
    targetField.input.value = pickRandomTarget([startField.input.value]);
    targetField.setError();
  };
  startField.dice.addEventListener('click', () => void rollStart());
  targetField.dice.addEventListener('click', rollTarget);
  randomPairBtn.addEventListener('click', async () => {
    rollTarget();
    await rollStart();
  });

  const form = h(
    'form',
    { class: 'race-form panel', attrs: { novalidate: '' } },
    startField.element,
    targetField.element,
    difficulty.element,
    generalError,
    h('div', { class: 'form-actions' }, startBtn, randomPairBtn),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    startField.setError();
    targetField.setError();
    generalError.hidden = true;
    setBusy(true);
    const result = await validatePair(client, startField.input.value, targetField.input.value);
    setBusy(false);
    if (!result.ok) {
      startField.setError(result.errors.start);
      targetField.setError(result.errors.target);
      if (result.errors.general) {
        generalError.textContent = result.errors.general;
        generalError.hidden = false;
      }
      (result.errors.start ? startField.input : targetField.input).focus();
      return;
    }
    options.onStart({ pair: result.pair, difficulty: difficulty.value() });
  });

  // Settings and the local Hard-mode counter.
  const reduce = h('input', { attrs: { type: 'checkbox', id: 'reduce-motion' } });
  reduce.checked = settings.reduceMotion;
  reduce.addEventListener('change', () => (settings.reduceMotion = reduce.checked));
  const wins = settings.hardWins;

  const demo = new TitleDemo();
  const element = h(
    'main',
    { class: 'screen screen-title' },
    h(
      'nav',
      { class: 'title-nav' },
      h('span', { class: 'title-version' }, 'S.I.L.K ', h('span', { text: '/ v0.2' })),
      h(
        'div',
        { class: 'title-links' },
        h('a', { text: 'How it works', attrs: { href: '#how' } }),
        h('a', { text: 'GitHub', attrs: { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' } }),
      ),
    ),
    h(
      'section',
      { class: 'title-hero' },
      // Row 1: who and what.
      h(
        'header',
        { class: 'hero-head' },
        h(
          'div',
          { class: 'hero-title' },
          h('p', { class: 'kicker', text: 'Wikirace // you vs. a crawling spider' }),
          h('h1', { class: 'hero-logo' }, logoMark('logo-big')),
          h('p', { class: 'hero-sub', text: GAME_FULL_NAME }),
        ),
        h(
          'p',
          { class: 'hero-pitch', text: 'Pick two Wikipedia pages. Click your way from one to the other while an AI spider crawls the same web, smashing words and diving into links. First one there wins.' },
        ),
      ),
      // Row 2: play, and watch the spider. Same height, same edges.
      h('div', { class: 'hero-play' }, form, demo.element),
      // Row 3: the fine print and the settings.
      h(
        'footer',
        { class: 'title-foot' },
        h('p', { text: 'Article text from Wikipedia, CC BY-SA 4.0. Not affiliated with the Wikimedia Foundation.' }),
        h(
          'div',
          { class: 'title-settings' },
          h('label', { class: 'toggle', attrs: { for: 'reduce-motion' } }, reduce, h('span', { class: 'toggle-ui', attrs: { 'aria-hidden': 'true' } }), 'Reduce motion'),
          h('span', { class: 'hard-wins', attrs: { title: 'Counted in this browser only' } }, 'Hard mode wins: ', h('strong', { text: String(wins) })),
        ),
      ),
    ),
    howItWorks(),
  );

  return {
    element,
    mount: () => demo.start(),
    destroy: () => demo.destroy(),
  };
}

interface TitleField {
  element: HTMLElement;
  row: HTMLElement;
  input: HTMLInputElement;
  dice: HTMLButtonElement;
  setError: (message?: string) => void;
}

function titleField(id: string, label: string, placeholder: string, client: WikiClient): TitleField {
  const inputId = `field-${id}`;
  const input = h('input', { class: 'input', attrs: { id: inputId, name: id, type: 'text', placeholder } });
  const dice = h('button', {
    class: 'btn btn-icon',
    attrs: { type: 'button', title: `Random ${label.toLowerCase()}`, 'aria-label': `Random ${label.toLowerCase()}` },
  });
  dice.append(icon('dice', 20));
  const error = h('p', { class: 'field-error', attrs: { id: `${inputId}-error` } });
  error.hidden = true;
  const autocomplete = new Autocomplete({
    input,
    search: async (q) => {
      try {
        return await client.searchPages(q);
      } catch {
        return client.searchTitles(q);
      }
    },
  });
  const row = h('div', { class: 'field-row' }, h('div', { class: 'field-input' }, input, autocomplete.list), dice);
  const element = h('div', { class: 'field' }, h('label', { class: 'field-label', text: label, attrs: { for: inputId } }), row, error);
  return {
    element,
    row,
    input,
    dice,
    setError(message?: string) {
      error.textContent = message ?? '';
      error.hidden = !message;
      if (message) input.setAttribute('aria-describedby', error.id);
      else input.removeAttribute('aria-describedby');
      input.setAttribute('aria-invalid', String(!!message));
    },
  };
}

/** Easy / Normal / Hard as a radio group styled as a segmented control. */
function difficultyPicker(initial: DifficultyId): { element: HTMLElement; value: () => DifficultyId } {
  const blurb = h('p', { class: 'difficulty-blurb', attrs: { 'aria-live': 'polite' } });
  const radios = Object.values(DIFFICULTIES).map((d) => {
    const input = h('input', { attrs: { type: 'radio', name: 'difficulty', value: d.id, id: `difficulty-${d.id}` } });
    input.checked = d.id === initial;
    input.addEventListener('change', () => (blurb.textContent = d.blurb));
    return { d, input };
  });
  blurb.textContent = DIFFICULTIES[initial].blurb;
  const element = h(
    'fieldset',
    { class: 'difficulty' },
    h('legend', { class: 'field-label', text: 'Spider difficulty' }),
    h(
      'div',
      { class: 'difficulty-options' },
      ...radios.map(({ d, input }) => h('label', { class: `difficulty-option is-${d.id}`, attrs: { for: input.id } }, input, h('span', { text: d.label }))),
    ),
    blurb,
  );
  return { element, value: () => radios.find((r) => r.input.checked)?.d.id ?? initial };
}

/** "How it works": the hop cycle, the move set, the difficulty levels. */
function howItWorks(): HTMLElement {
  const step = (kind: IllustrationKind, number: string, title: string, text: string) =>
    h(
      'article',
      { class: 'how-card' },
      illustration(kind),
      h('h3', { class: 'how-title' }, number ? h('span', { text: `${number} · ` }) : null, title),
      h('p', { text }),
    );
  return h(
    'section',
    { class: 'how', attrs: { id: 'how' } },
    h('header', { class: 'how-head' }, h('h2', { text: 'How the spider crawls' }), h('p', { text: 'one hop = scan → crawl & eat → grab → hop · loops until target' })),
    h(
      'div',
      { class: 'how-grid' },
      step('scan', '01', 'scan', 'Lands on a page and fires a ray at every link to score it: direct hit, links back to the target, or closest in meaning.'),
      step('crawl', '02', 'crawl & eat', 'Walks over the real text toward the link. Each foot grabs a word (cyan box); words under its jaws get struck out and break apart.'),
      step('grab', '03', 'grab', 'Reaches the link and wraps all eight legs around it. The link lights up and the page edges start to glitch.'),
      step('hop', '04', 'hop', 'The old page glitches out in RGB-split slices, the next article loads, and the spider drops in on its silk thread.'),
    ),
    h('header', { class: 'how-head' }, h('h2', { text: 'Spider move set' }), h('p', { text: 'simple body, flashy moves · triggered at random while it crawls' })),
    h(
      'div',
      { class: 'how-grid' },
      step('laser', '', 'eye laser', 'Fires from the red eye to lock the next link, and slices words in half on the way. Sparks at the cut.'),
      step('throw', '', 'grab & throw', 'A front leg plucks a word out of the text and flings it off the page, spinning. It leaves a dashed hole behind.'),
      step('stomp', '', 'stomp', 'Slams a foot onto a short word: impact rings, a small screen shake, and the word squashes flat.'),
      step('zip', '', 'web zip', 'Only when the best link is very far down the page: it shoots a silk line at it and zips there in one move. Otherwise it goes on foot.'),
    ),
    h('header', { class: 'how-head' }, h('h2', { text: 'Difficulty' }), h('p', { text: 'same brain on every level · only its manners change' })),
    h(
      'div',
      { class: 'how-levels' },
      level('Easy', 'is-easy', ['Slow thinker.', 'Only crawls and eats its own page.', 'Never attacks you.', 'Winnable.']),
      level('Normal', 'is-normal', [
        'Web traps, a fan laser that burns every word it sweeps, word bombardments.',
        'About one attack every 25 s, faster in rage (when your page links to the target).',
        'Hard but winnable.',
      ]),
      level('Hard', 'is-hard', [
        'Near-instant thinking, runs across the page smashing everything, rage always on.',
        'An attack every 4–8 s, chained, no warning: webs, fan lasers, word bombs, fake target links full of mini-spiders, and now and then a silk line on your cursor.',
        'Once a race, after your first three links, it steals the link that would put you ahead: it leaps across, eats it, dives in, and the panes swap.',
        'Expected win rate: almost zero.',
      ]),
    ),
  );
}

function level(name: string, className: string, lines: string[]): HTMLElement {
  return h('article', { class: `how-level ${className}` }, h('h3', { text: name }), h('ul', {}, ...lines.map((line) => h('li', { text: line }))));
}
