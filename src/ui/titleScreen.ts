/**
 * Title screen (mockup "Title screen"): the pitch, the race form (start and
 * target pages with autocomplete and dice, difficulty), a live demo of the
 * spider, settings (Reduce motion) and the local Hard-mode win counter, then
 * "How it works" below the fold. The language picker (French or English:
 * the texts and the Wikipedia the race runs on) sits in the top bar.
 */
import { GAME_FULL_NAME, REPO_URL } from '../config';
import { DIFFICULTIES, type DifficultyId } from '../game/difficulty';
import { pickRandomStart, pickRandomTarget, validatePair, type ValidatedPair } from '../game/pairs';
import { lang, LANGS, t, type Lang } from '../i18n';
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
  /** The player picked another language: the screen is rebuilt in it. */
  onLanguage: (lang: Lang) => void;
}

export interface TitleScreen {
  element: HTMLElement;
  /** Starts the animations once the element is in the document. */
  mount(): void;
  destroy(): void;
}

export function createTitleScreen(options: TitleScreenOptions): TitleScreen {
  const { client } = options;
  const text = t().title;
  const startField = titleField('start', text.start, client);
  const targetField = titleField('target', text.target, client);
  startField.input.value = options.initialStart ?? '';
  targetField.input.value = options.initialTarget ?? '';

  const difficulty = difficultyPicker(options.initialDifficulty);
  const generalError = h('p', { class: 'field-error', attrs: { role: 'alert' } });
  generalError.hidden = true;
  const startBtn = h('button', { class: 'btn btn-primary btn-start', text: text.startRace, attrs: { type: 'submit' } });
  const randomPairBtn = h('button', { class: 'btn btn-ghost btn-random', attrs: { type: 'button' } }, icon('dice', 18), text.randomPair);

  const setBusy = (busy: boolean) => {
    for (const el of [randomPairBtn, startBtn, startField.dice, targetField.dice]) el.disabled = busy;
    startBtn.textContent = busy ? text.checking : text.startRace;
  };

  const rollStart = async () => {
    startField.dice.disabled = true;
    startField.input.value = '';
    startField.input.placeholder = text.rolling;
    try {
      startField.input.value = await pickRandomStart(client, [targetField.input.value]);
      startField.setError();
    } catch {
      startField.setError(text.randomFailed);
    } finally {
      startField.dice.disabled = false;
      startField.input.placeholder = text.start.placeholder;
    }
  };
  const rollTarget = () => {
    targetField.input.value = pickRandomTarget(lang(), [startField.input.value]);
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
      h('span', { class: 'title-version' }, 'S.I.L.K ', h('span', { text: '/ v0.3' })),
      h(
        'div',
        { class: 'title-links' },
        languagePicker(options.onLanguage),
        h('a', { text: text.howLink, attrs: { href: '#how' } }),
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
          h('p', { class: 'kicker', text: text.kicker }),
          h('h1', { class: 'hero-logo' }, logoMark('logo-big')),
          h('p', { class: 'hero-sub', text: GAME_FULL_NAME }),
        ),
        h('p', { class: 'hero-pitch', text: text.pitch }),
      ),
      // Row 2: play, and watch the spider. Same height, same edges.
      h('div', { class: 'hero-play' }, form, demo.element),
      // Row 3: the fine print and the settings.
      h(
        'footer',
        { class: 'title-foot' },
        h('p', { text: text.foot }),
        h(
          'div',
          { class: 'title-settings' },
          h('label', { class: 'toggle', attrs: { for: 'reduce-motion' } }, reduce, h('span', { class: 'toggle-ui', attrs: { 'aria-hidden': 'true' } }), text.reduceMotion),
          h('span', { class: 'hard-wins', attrs: { title: text.hardWinsHint } }, text.hardWins, h('strong', { text: String(wins) })),
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

function titleField(id: string, text: { label: string; placeholder: string; dice: string }, client: WikiClient): TitleField {
  const { label, placeholder } = text;
  const inputId = `field-${id}`;
  const input = h('input', { class: 'input', attrs: { id: inputId, name: id, type: 'text', placeholder, lang: t().htmlLang } });
  const dice = h('button', {
    class: 'btn btn-icon',
    attrs: { type: 'button', title: text.dice, 'aria-label': text.dice },
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
  const levels = t().difficulties;
  const blurb = h('p', { class: 'difficulty-blurb', attrs: { 'aria-live': 'polite' } });
  const radios = Object.values(DIFFICULTIES).map((d) => {
    const input = h('input', { attrs: { type: 'radio', name: 'difficulty', value: d.id, id: `difficulty-${d.id}` } });
    input.checked = d.id === initial;
    input.addEventListener('change', () => (blurb.textContent = levels[d.id].blurb));
    return { d, input };
  });
  blurb.textContent = levels[initial].blurb;
  const element = h(
    'fieldset',
    { class: 'difficulty' },
    h('legend', { class: 'field-label', text: t().title.difficulty }),
    h(
      'div',
      { class: 'difficulty-options' },
      ...radios.map(({ d, input }) => h('label', { class: `difficulty-option is-${d.id}`, attrs: { for: input.id } }, input, h('span', { text: levels[d.id].label }))),
    ),
    blurb,
  );
  return { element, value: () => radios.find((r) => r.input.checked)?.d.id ?? initial };
}

/** FR / EN: the texts, and the Wikipedia the race is run on. */
function languagePicker(onPick: (lang: Lang) => void): HTMLElement {
  return h(
    'div',
    { class: 'lang-picker', attrs: { role: 'group', 'aria-label': t().title.language } },
    ...LANGS.map((code) =>
      h('button', {
        class: `lang-option ${code === lang() ? 'is-active' : ''}`,
        text: t(code).short,
        attrs: { type: 'button', lang: t(code).htmlLang, title: t(code).name, 'aria-pressed': String(code === lang()) },
        on: { click: () => code !== lang() && onPick(code) },
      }),
    ),
  );
}

/** "How it works": the hop cycle, the move set, the difficulty levels. */
function howItWorks(): HTMLElement {
  const how = t().how;
  const levels = t().difficulties;
  const step = (kind: IllustrationKind, number: string, [title, text]: string[]) =>
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
    h('header', { class: 'how-head' }, h('h2', { text: how.crawl.title }), h('p', { text: how.crawl.sub })),
    h(
      'div',
      { class: 'how-grid' },
      step('scan', '01', how.steps.scan),
      step('crawl', '02', how.steps.crawl),
      step('grab', '03', how.steps.grab),
      step('hop', '04', how.steps.hop),
    ),
    h('header', { class: 'how-head' }, h('h2', { text: how.moves.title }), h('p', { text: how.moves.sub })),
    h(
      'div',
      { class: 'how-grid' },
      step('laser', '', how.moveCards.laser),
      step('throw', '', how.moveCards.throw),
      step('stomp', '', how.moveCards.stomp),
      step('zip', '', how.moveCards.zip),
    ),
    h('header', { class: 'how-head' }, h('h2', { text: how.levels.title }), h('p', { text: how.levels.sub })),
    h(
      'div',
      { class: 'how-levels' },
      level(levels.easy.label, 'is-easy', how.levelLines.easy),
      level(levels.normal.label, 'is-normal', how.levelLines.normal),
      level(levels.hard.label, 'is-hard', how.levelLines.hard),
    ),
  );
}

function level(name: string, className: string, lines: string[]): HTMLElement {
  return h('article', { class: `how-level ${className}` }, h('h3', { text: name }), h('ul', {}, ...lines.map((line) => h('li', { text: line }))));
}
