/**
 * Accessible title autocomplete (ARIA 1.2 combobox pattern) backed by the
 * Wikipedia opensearch API.
 */
import { h } from './dom';

export interface AutocompleteOptions {
  input: HTMLInputElement;
  search: (query: string) => Promise<string[]>;
  onSelect?: (title: string) => void;
  debounceMs?: number;
}

let nextId = 0;

export class Autocomplete {
  readonly list: HTMLUListElement;
  private items: string[] = [];
  private active = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Incremented on every query so that late responses can be ignored. */
  private sequence = 0;

  constructor(private readonly options: AutocompleteOptions) {
    const { input } = options;
    const listId = `ac-list-${nextId++}`;
    this.list = h('ul', { class: 'ac-list', attrs: { id: listId, role: 'listbox' } });
    this.list.hidden = true;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');
    input.autocomplete = 'off';
    input.spellcheck = false;

    input.addEventListener('input', () => this.scheduleSearch());
    input.addEventListener('keydown', (event) => this.onKeyDown(event));
    input.addEventListener('blur', () => this.close());
    // mousedown (not click) fires before the input's blur closes the list.
    this.list.addEventListener('mousedown', (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) return;
      event.preventDefault();
      this.choose(Number(option.dataset.index));
    });
  }

  private scheduleSearch(): void {
    clearTimeout(this.timer);
    const query = this.options.input.value.trim();
    if (query.length < 2) {
      this.sequence++;
      this.close();
      return;
    }
    this.timer = setTimeout(() => void this.runSearch(query), this.options.debounceMs ?? 220);
  }

  private async runSearch(query: string): Promise<void> {
    const ticket = ++this.sequence;
    let results: string[];
    try {
      results = await this.options.search(query);
    } catch {
      results = [];
    }
    // Ignore stale answers and answers arriving after the field lost focus.
    if (ticket !== this.sequence || document.activeElement !== this.options.input) return;
    this.open(results);
  }

  private open(results: string[]): void {
    this.items = results;
    this.active = -1;
    this.list.replaceChildren(
      ...results.map((title, index) =>
        h('li', {
          class: 'ac-option',
          text: title,
          attrs: { role: 'option', id: `${this.list.id}-${index}`, 'aria-selected': 'false' },
          dataset: { index: String(index) },
        }),
      ),
    );
    const visible = results.length > 0;
    this.list.hidden = !visible;
    this.options.input.setAttribute('aria-expanded', String(visible));
    this.options.input.removeAttribute('aria-activedescendant');
  }

  close(): void {
    this.list.hidden = true;
    this.items = [];
    this.active = -1;
    this.options.input.setAttribute('aria-expanded', 'false');
    this.options.input.removeAttribute('aria-activedescendant');
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.list.hidden || this.items.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.highlight((this.active + 1) % this.items.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlight((this.active - 1 + this.items.length) % this.items.length);
        break;
      case 'Enter':
        if (this.active >= 0) {
          event.preventDefault();
          this.choose(this.active);
        } else {
          this.close();
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  private highlight(index: number): void {
    this.active = index;
    this.list.querySelectorAll<HTMLElement>('[role="option"]').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === index));
      el.classList.toggle('is-active', i === index);
      if (i === index) el.scrollIntoView({ block: 'nearest' });
    });
    this.options.input.setAttribute('aria-activedescendant', `${this.list.id}-${index}`);
  }

  private choose(index: number): void {
    const title = this.items[index];
    if (title === undefined) return;
    this.options.input.value = title;
    this.sequence++;
    this.close();
    this.options.onSelect?.(title);
  }
}
