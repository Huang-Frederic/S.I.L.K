/**
 * Role-agnostic panes: ownership swaps, link damage and anchor lookup
 * (jsdom has no layout, so geometry is not tested here).
 */
import { describe, expect, it } from 'vitest';
import { setLang } from '../../src/i18n';
import type { CandidateLink } from '../../src/spider/ai/types';
import { findAnchor } from '../../src/spider/runner';
import { RacerPane } from '../../src/stage/racerPane';
import type { LoadedArticle } from '../../src/wiki/articles';
import { sanitizeArticle } from '../../src/wiki/sanitize';

function loaded(title: string, html: string): LoadedArticle {
  return { title, redirectedFrom: null, article: sanitizeArticle(`<body><section><p>${html}</p></section></body>`, { title }) };
}

const link = (to: string, text = to) => `<a rel="mw:WikiLink" href="./${to.replace(/ /g, '_')}">${text}</a>`;

describe('RacerPane', () => {
  it('follows its owner: badge, colours, back button, clickability', () => {
    const pane = new RacerPane('player', 'left');
    expect(pane.element.classList.contains('is-player')).toBe(true);
    // English by default.
    expect(pane.badgeElement.textContent).toBe('YOU');
    expect(pane.scroller.inert).toBe(false);

    pane.setOwner('spider');
    expect(pane.element.classList.contains('is-spider')).toBe(true);
    expect(pane.element.classList.contains('is-player')).toBe(false);
    expect(pane.badgeElement.textContent).toBe('SPIDER');
    setLang('fr');
    pane.setOwner('spider');
    expect(pane.badgeElement.textContent).toBe('ARAIGNÉE');
    setLang('en');
    expect(pane.scroller.inert).toBe(true);
    expect(pane.element.querySelector<HTMLElement>('.pane-back')!.hidden).toBe(true);
    expect(pane.element.querySelector<HTMLElement>('.brain')!.hidden).toBe(false);
  });

  it('shortens long breadcrumbs in the middle', () => {
    const pane = new RacerPane('spider', 'right');
    pane.setCrumbs(['Silk', 'Textile', 'Loom', 'Jacquard machine', 'Computer graphics']);
    expect(pane.element.querySelector('.pane-crumbs')!.textContent).toBe('Silk → Textile → … → Computer graphics');
  });

  it('blocks damaged links, lifts timed damage, keeps permanent damage', () => {
    const pane = new RacerPane('player', 'left');
    document.body.append(pane.element);
    pane.showArticle(loaded('Silk', `${link('Silk Road')} and ${link('Printing')} and ${link('Paper')}`));
    const [road, printing, paper] = pane.links();
    expect(pane.links()).toHaveLength(3);

    pane.damageLink(road, 'webbed', 5);
    pane.damageLink(printing, 'burned');
    expect(pane.usable(road)).toBe(false);
    expect(road.classList.contains('is-webbed')).toBe(true);
    expect(road.getAttribute('aria-disabled')).toBe('true');
    expect(pane.usable(paper)).toBe(true);

    // A burned link stays burned, whatever lands on it later.
    pane.damageLink(printing, 'covered', 1);
    expect(pane.damageOf(printing)).toBe('burned');

    pane.expireDamage(6);
    expect(pane.usable(road)).toBe(true);
    expect(road.classList.contains('is-webbed')).toBe(false);
    expect(pane.usable(printing)).toBe(false);

    // A webbed link that gets burned looks burned, not webbed.
    pane.damageLink(paper, 'webbed', 10);
    pane.damageLink(paper, 'burned');
    expect(paper.classList.contains('is-webbed')).toBe(false);
    expect(paper.classList.contains('is-burned')).toBe(true);
    pane.expireDamage(20);
    expect(pane.usable(paper)).toBe(false);

    // A new article starts clean.
    const generation = pane.generation;
    pane.showArticle(loaded('Paper', link('Silk')));
    expect(pane.generation).toBe(generation + 1);
    expect(pane.links().every((a) => pane.usable(a))).toBe(true);
  });

  it('finds the anchor of a candidate link, ignoring decoys', () => {
    const pane = new RacerPane('spider', 'right');
    pane.showArticle(loaded('Silk', `${link('Silk Road', 'the road')}, ${link('Printing')} and ${link('Printing', 'print')}`));
    const decoy = document.createElement('a');
    decoy.className = 'wiki-link is-decoy';
    decoy.dataset.title = 'Printing';
    decoy.dataset.decoy = '1';
    pane.articleElement!.prepend(decoy);

    const candidate = (title: string, order: number): CandidateLink => ({ title, linkedTitle: title, text: title, order });
    expect(findAnchor(pane, candidate('Printing', 1))!.textContent).toBe('Printing');
    expect(findAnchor(pane, candidate('Silk Road', 0))!.textContent).toBe('the road');
    // Wrong order (the page changed): falls back to the title.
    expect(findAnchor(pane, candidate('Printing', 7))!.textContent).toBe('Printing');
    expect(findAnchor(pane, candidate('Nowhere', 0))).toBeNull();
    expect(pane.decoys()).toEqual([decoy]);
  });
});
