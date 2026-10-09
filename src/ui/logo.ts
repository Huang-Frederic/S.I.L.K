/** The S.I.L.K wordmark: white letters joined by red round dots. */
import { h } from './dom';

export function logoMark(className = ''): HTMLElement {
  const el = h('span', { class: `logo ${className}`.trim(), attrs: { role: 'img', 'aria-label': 'S.I.L.K' } });
  'SILK'.split('').forEach((letter, i) => {
    if (i) el.append(h('i', { class: 'logo-dot', attrs: { 'aria-hidden': 'true' } }));
    el.append(h('span', { text: letter, attrs: { 'aria-hidden': 'true' } }));
  });
  return el;
}
