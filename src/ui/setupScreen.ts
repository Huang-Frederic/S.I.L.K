/**
 * Title / setup screen: pick the start and target articles (typed with
 * autocomplete, or rolled at random), the spider's difficulty, and start.
 */
import { GAME_FULL_NAME, GAME_NAME } from '../config';
import { DIFFICULTIES, type DifficultyId } from '../game/difficulty';
import { pickRandomStart, pickRandomTarget, validatePair, type ValidatedPair } from '../game/pairs';
import type { WikiClient } from '../wiki/client';
import { Autocomplete } from './autocomplete';
import { h } from './dom';
import { icon } from './icons';

export interface SetupChoice {
  pair: ValidatedPair;
  difficulty: DifficultyId;
}

export interface SetupScreenOptions {
  client: WikiClient;
  initialStart?: string;
  initialTarget?: string;
  initialDifficulty: DifficultyId;
  /** Optional element shown above the title (the animated logo). */
  logo?: HTMLElement;
  onStart: (choice: SetupChoice) => void;
}

export function createSetupScreen(options: SetupScreenOptions): HTMLElement {
  const { client } = options;

  const startField = titleField('start', 'Start article', 'e.g. Platypus', client);
  const targetField = titleField('target', 'Target article', 'e.g. Albert Einstein', client);
  startField.input.value = options.initialStart ?? '';
  targetField.input.value = options.initialTarget ?? '';

  const difficulty = difficultyPicker(options.initialDifficulty);

  const generalError = h('p', { class: 'field-error', attrs: { role: 'alert' } });
  generalError.hidden = true;

  const swapBtn = h('button', {
    class: 'btn btn-secondary btn-icon setup-swap',
    attrs: { type: 'button', title: 'Swap start and target', 'aria-label': 'Swap start and target' },
  });
  swapBtn.append(icon('swap'));
  const randomPairBtn = h('button', { class: 'btn btn-secondary', attrs: { type: 'button' } }, icon('dice'), 'Random pair');
  const startBtn = h('button', { class: 'btn btn-primary', text: 'Start race', attrs: { type: 'submit' } });

  const setBusy = (busy: boolean) => {
    for (const el of [randomPairBtn, startBtn, swapBtn, startField.dice, targetField.dice]) el.disabled = busy;
    startBtn.textContent = busy ? 'Checking…' : 'Start race';
  };

  const rollStart = async () => {
    startField.dice.disabled = true;
    startField.input.value = '';
    startField.input.placeholder = 'Rolling a random article…';
    try {
      startField.input.value = await pickRandomStart(client, [targetField.input.value]);
      startField.setError();
    } finally {
      startField.dice.disabled = false;
      startField.input.placeholder = 'e.g. Platypus';
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
  swapBtn.addEventListener('click', () => {
    [startField.input.value, targetField.input.value] = [targetField.input.value, startField.input.value];
    startField.setError();
    targetField.setError();
  });

  const form = h(
    'form',
    { class: 'setup-form panel', attrs: { novalidate: '' } },
    startField.element,
    h('div', { class: 'setup-swap-row' }, swapBtn),
    targetField.element,
    difficulty.element,
    generalError,
    h('div', { class: 'setup-actions' }, randomPairBtn, startBtn),
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

  return h(
    'main',
    { class: 'screen screen-setup' },
    h(
      'div',
      { class: 'setup-inner' },
      h(
        'header',
        { class: 'setup-header' },
        options.logo ?? null,
        h('h1', { class: options.logo ? 'visually-hidden' : 'setup-logo-text', text: GAME_NAME }),
        h('p', { class: 'setup-subtitle', text: GAME_FULL_NAME }),
      ),
      h(
        'p',
        { class: 'setup-pitch' },
        'Race an AI web-crawler spider across Wikipedia. Same start article, same target: click links only, first to arrive wins.',
      ),
      form,
      h(
        'p',
        { class: 'setup-note' },
        'Articles come live from English Wikipedia. The spider runs a small sentence-embedding model in your browser to judge which link looks closest to the target.',
      ),
    ),
  );
}

interface TitleField {
  element: HTMLElement;
  input: HTMLInputElement;
  dice: HTMLButtonElement;
  setError: (message?: string) => void;
}

function titleField(id: string, label: string, placeholder: string, client: WikiClient): TitleField {
  const inputId = `field-${id}`;
  const input = h('input', { class: 'input', attrs: { id: inputId, name: id, type: 'text', placeholder } });
  const dice = h('button', {
    class: 'btn btn-secondary btn-icon',
    attrs: { type: 'button', title: `Random ${label.toLowerCase()}`, 'aria-label': `Random ${label.toLowerCase()}` },
  });
  dice.append(icon('dice'));
  const error = h('p', { class: 'field-error', attrs: { id: `${inputId}-error` } });
  error.hidden = true;
  const autocomplete = new Autocomplete({ input, search: (q) => client.searchTitles(q) });
  const element = h(
    'div',
    { class: 'field' },
    h('label', { class: 'label', text: label, attrs: { for: inputId } }),
    h('div', { class: 'field-row' }, h('div', { class: 'field-input' }, input, autocomplete.list), dice),
    error,
  );
  return {
    element,
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
    h('legend', { class: 'label', text: 'Spider difficulty' }),
    h(
      'div',
      { class: 'difficulty-options' },
      ...radios.map(({ d, input }) =>
        h('label', { class: `difficulty-option is-${d.id}`, attrs: { for: input.id } }, input, h('span', { text: d.label })),
      ),
    ),
    blurb,
  );
  return {
    element,
    value: () => (radios.find((r) => r.input.checked)?.d.id ?? initial),
  };
}
