/**
 * Title / setup screen: pick the start and target articles (typed with
 * autocomplete, or rolled at random) and start the race.
 */
import { GAME_FULL_NAME, GAME_NAME } from '../config';
import { pickRandomStart, pickRandomTarget, validatePair, type ValidatedPair } from '../game/pairs';
import type { WikiClient } from '../wiki/client';
import { Autocomplete } from './autocomplete';
import { h } from './dom';

export interface SetupChoice {
  pair: ValidatedPair;
}

export interface SetupScreenOptions {
  client: WikiClient;
  initialStart?: string;
  initialTarget?: string;
  onStart: (choice: SetupChoice) => void;
}

export function createSetupScreen(options: SetupScreenOptions): HTMLElement {
  const { client } = options;

  const startField = titleField('start', 'Start article', 'e.g. Platypus', client);
  const targetField = titleField('target', 'Target article', 'e.g. Albert Einstein', client);
  startField.input.value = options.initialStart ?? '';
  targetField.input.value = options.initialTarget ?? '';

  const generalError = h('p', { class: 'field-error', attrs: { role: 'alert' } });
  generalError.hidden = true;

  const randomPairBtn = h('button', { class: 'btn btn-secondary', text: 'Random pair', attrs: { type: 'button' } });
  const startBtn = h('button', { class: 'btn', text: 'Start race ▶', attrs: { type: 'submit' } });

  const setBusy = (busy: boolean) => {
    for (const el of [randomPairBtn, startBtn, startField.dice, targetField.dice]) el.disabled = busy;
    startBtn.textContent = busy ? 'Checking…' : 'Start race ▶';
  };

  const rollStart = async () => {
    startField.dice.disabled = true;
    startField.input.value = '…';
    try {
      startField.input.value = await pickRandomStart(client, [targetField.input.value]);
      startField.setError();
    } finally {
      startField.dice.disabled = false;
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
    { class: 'setup-form panel', attrs: { novalidate: '' } },
    startField.element,
    targetField.element,
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
      return;
    }
    options.onStart({ pair: result.pair });
  });

  return h(
    'main',
    { class: 'screen screen-setup' },
    h(
      'div',
      { class: 'setup-inner' },
      h('header', { class: 'setup-header' }, h('h1', { class: 'setup-logo-text', text: GAME_NAME }), h('p', { class: 'setup-subtitle', text: GAME_FULL_NAME })),
      h(
        'p',
        { class: 'setup-pitch' },
        'Race an AI web-crawler spider across Wikipedia. Same start article, same target: click links only, first to arrive wins.',
      ),
      form,
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
    text: '🎲',
    attrs: { type: 'button', title: `Random ${label.toLowerCase()}`, 'aria-label': `Random ${label.toLowerCase()}` },
  });
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
