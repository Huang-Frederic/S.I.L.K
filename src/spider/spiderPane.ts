/**
 * The spider's half of the screen: its own read-only copy of the article and
 * a full-resolution overlay canvas where the crawler walks, indexes links,
 * eats words and dives into links.
 *
 * Animations are written as coroutines: each step awaits `nextFrame()`, which
 * the requestAnimationFrame loop resolves with the frame's delta time. The
 * race controller simply awaits the high-level actions:
 *
 *   await pane.enter(page)               // page streams in, spider drops in
 *   await pane.think(ms, decision)       // scanning ("indexing") the links
 *   await pane.crawlTo(link, label)      // lock on, abseil, walk + eat words
 *   const hole = await pane.dive()       // slide into the link, page warps in
 *   await pane.enter(next, hole)         // next page streams out of the link
 */
import type { Difficulty } from '../game/difficulty';
import { ArticleView } from '../ui/articleView';
import { h } from '../ui/dom';
import type { LoadedArticle } from '../wiki/articles';
import { boxCenter, distanceToBox, OverlayCanvas, type Box, type Point } from './render/canvas';
import { Crawler, type FootHold, type Ground } from './render/crawler';
import { BiteMarks, drawBeam, drawLabel, drawScan, drawSilk, drawTargetLock, LinkMarks, NEON, Shards } from './render/fx';
import { cameraTarget, crossesLines, planWalk, wordsAroundLink } from './render/route';
import { captureText, Warp } from './render/warp';
import { eatWord, isEaten, textBlockOf, wrapWords } from './render/words';

/** Thrown into pending animations when the pane is destroyed. */
export class PaneClosedError extends Error {
  constructor() {
    super('Spider pane closed');
    this.name = 'PaneClosedError';
  }
}

/** What the spider needs to know about the link it is heading to. */
export interface LinkTarget {
  title: string;
  linkedTitle: string;
  /** Index among the article's playable links (reading order). */
  order: number;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class SpiderPane {
  readonly element: HTMLElement;
  readonly view: ArticleView;
  private readonly fx: OverlayCanvas;
  private readonly spider = new Crawler();
  private readonly shards = new Shards();
  private readonly bites = new BiteMarks();
  private readonly marks = new LinkMarks();
  private readonly hopsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly brainEl: HTMLElement;
  private readonly ground: Ground = { hold: (p) => this.footHold(p) };

  private difficulty: Difficulty;
  /** Dragline: points the silk passes through (content coordinates). */
  private silk: Point[] = [];
  /** While abseiling or climbing: the point the thread hangs from. */
  private ropeAnchor: Point | null = null;
  private warp: Warp | null = null;
  /** The locked target link, its label and when it was locked. */
  private lock: { el: HTMLElement; label: string; since: number } | null = null;
  private linkEls: HTMLElement[] = [];
  private linkBoxes: Box[] = [];
  private thinking = false;
  private thinkTime = 0;
  private time = 0;
  private camY = 0;
  private follow = false;
  private frame = 0;
  private rafId = 0;
  private lastTime = 0;
  private paused = false;
  private drawnWhilePaused = false;
  private closed = false;
  private waiters: Array<{ resolve: (dt: number) => void; reject: (error: Error) => void }> = [];

  constructor(options: { difficulty: Difficulty }) {
    this.difficulty = options.difficulty;
    this.view = new ArticleView({ className: 'is-spider' });
    this.fx = new OverlayCanvas(this.view.element, this.view.scroller);
    this.fx.onResize(() => this.refreshLayout());
    this.spider.visible = false;

    this.hopsEl = h('strong', { text: '0' });
    this.statusEl = h('span', { class: 'pane-where spider-status', text: 'Booting…', attrs: { 'aria-live': 'polite' } });
    this.brainEl = h('span', { class: 'spider-brain' });
    this.element = h(
      'section',
      { class: 'pane pane-spider', attrs: { 'aria-label': "The spider's article" } },
      h(
        'div',
        { class: 'pane-bar' },
        h('span', { class: 'pane-who', text: 'Spider' }),
        h('span', { class: 'pane-stat' }, 'hops ', this.hopsEl),
        this.statusEl,
        this.brainEl,
      ),
      this.view.element,
    );
    this.refreshLayout();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ status

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }

  setHops(hops: number): void {
    this.hopsEl.textContent = String(hops);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.title = text;
  }

  /** Small badge describing the spider's brain (semantic model state). */
  setBrain(text: string, title = ''): void {
    this.brainEl.textContent = text;
    this.brainEl.title = title;
    this.brainEl.hidden = !text;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  destroy(): void {
    this.closed = true;
    cancelAnimationFrame(this.rafId);
    for (const waiter of this.waiters) waiter.reject(new PaneClosedError());
    this.waiters = [];
    this.fx.destroy();
  }

  // ------------------------------------------------------------------ actions

  /**
   * Shows a new article. Its text streams out of `origin` (viewport
   * coordinates, e.g. the hole left by the previous dive) or out of the top
   * edge, then the spider drops in on a thread next to the title.
   */
  async enter(loaded: LoadedArticle, origin: Point | null = null): Promise<void> {
    this.view.element.classList.add('is-warping');
    this.view.render(loaded);
    this.camY = 0;
    this.follow = false;
    this.bites.clear();
    this.shards.clear();
    this.marks.clear();
    this.silk = [];
    this.lock = null;
    this.ropeAnchor = null;
    this.spider.visible = false;
    this.collectLinks();

    const article = this.view.articleElement!;
    const center = origin ?? { x: this.fx.width / 2, y: 0 };
    this.warp = new Warp(captureText(article, this.fx), center, 'out', this.duration(0.85));
    while (!this.warp.done) await this.nextFrame();
    this.warp = null;
    this.view.element.classList.remove('is-warping');

    // Drop in from the top edge on a fresh thread, legs folded.
    const spot = this.restingSpot();
    const s = this.spider;
    s.liftAll();
    Object.assign(s, { x: spot.x, y: -70, heading: Math.PI / 2, tuck: 1, scale: 1, visible: true });
    this.ropeAnchor = { x: spot.x, y: -80 };
    await this.moveTo(spot, 640, { accelerate: true });
    this.ropeAnchor = null;
    this.silk = [{ x: spot.x, y: -80 }, { ...spot }];
    await this.tween(0.22, (t) => {
      s.tuck = 1 - t;
      s.heading = Math.PI / 2 - (Math.PI / 2) * t;
    });
    s.plantAll(this.ground);
  }

  /** Thinks (indexing the visible links) for at least `minMs`, and until `work` settles. */
  async think<T>(minMs: number, work: Promise<T>): Promise<T> {
    let settled = false;
    let failed = false;
    let value: T | undefined;
    let error: unknown;
    work.then(
      (v) => {
        value = v;
        settled = true;
      },
      (e) => {
        error = e;
        failed = true;
        settled = true;
      },
    );
    this.thinking = true;
    this.thinkTime = 0;
    try {
      let elapsed = 0;
      while (elapsed < minMs / 1000 || !settled) elapsed += await this.nextFrame();
    } finally {
      this.thinking = false;
    }
    if (failed) throw error;
    return value as T;
  }

  /**
   * Locks onto a link, then walks there: abseils to its line if needed and
   * crawls along the line eating the words in between, until its mouth
   * touches the link.
   */
  async crawlTo(target: LinkTarget, label = ''): Promise<void> {
    const anchor = this.findAnchor(target);
    const article = this.view.articleElement;
    if (!anchor || !article) return;
    this.lock = { el: anchor, label, since: this.time };

    const block = textBlockOf(anchor, anchor.parentElement ?? article);
    const words = wrapWords(block).filter((w) => !anchor.contains(w) && !isEaten(w));
    const boxes = words.map((w) => this.fx.toContent(w.getClientRects()[0] ?? w.getBoundingClientRect()));
    const linkBox = this.anchorBox(anchor);
    const { before, after } = wordsAroundLink(linkBox, boxes);
    const plan = planWalk(
      linkBox,
      before.map((i) => boxes[i]),
      after.map((i) => boxes[i]),
      Crawler.MOUTH * this.spider.size,
    );
    const lineHeight = Math.max(16, linkBox.bottom - linkBox.top);
    const s = this.spider;
    this.follow = true;
    await this.wait(0.35); // let the lock-on register

    // 1. Reach the start of the walk: abseil on silk across lines, walk otherwise.
    const here = { x: s.x, y: s.y };
    if (crossesLines(here, plan.start, lineHeight)) {
      this.silk.push(here);
      this.ropeAnchor = here;
      s.liftAll();
      const facing = Math.atan2(plan.start.y - here.y, plan.start.x - here.x);
      await this.tween(0.16, (t) => {
        s.tuck = t;
        s.turnTowards(facing, 0.5);
      });
      await this.moveTo(plan.start, this.difficulty.ropeSpeed, { accelerate: true });
      this.ropeAnchor = null;
      this.silk.push({ ...plan.start });
      await this.tween(0.14, (t) => (s.tuck = 1 - t));
      s.plantAll(this.ground);
    } else {
      await this.moveTo(plan.start, this.difficulty.walkSpeed, { walk: true });
    }

    // 2. Face along the line, then walk to the link eating everything on the way.
    const facing = plan.direction === 1 ? 0 : Math.PI;
    await this.tween(0.18, () => s.turnTowards(facing, 0.5));
    let next = 0;
    const eatPending = () => {
      const mouthX = s.mouth().x;
      while (next < plan.eats.length) {
        const eat = plan.eats[next];
        const reached = plan.direction === 1 ? mouthX >= eat.atX : mouthX <= eat.atX;
        if (!reached) break;
        const index = (eat.side === 'before' ? before : after)[eat.index];
        this.eat(words[index], boxes[index]);
        next++;
      }
    };
    await this.moveTo(plan.end, this.difficulty.walkSpeed, { walk: true, face: facing, onStep: eatPending });
    eatPending();
    this.silk.push({ x: s.x, y: s.y });
  }

  /**
   * Slides into the locked link, then the page gets pulled into it.
   * Returns the hole (viewport coordinates) the next page will come out of.
   */
  async dive(): Promise<Point> {
    const s = this.spider;
    const anchor = this.lock?.el;
    const center = anchor ? boxCenter(this.anchorBox(anchor)) : { x: s.x, y: s.y };
    this.follow = false;
    s.liftAll();
    const from = { x: s.x, y: s.y, heading: s.heading };
    await this.tween(this.duration(0.42), (t) => {
      const e = t * t;
      s.x = from.x + (center.x - from.x) * e;
      s.y = from.y + (center.y - from.y) * e;
      s.scale = 1 - 0.92 * e;
      s.tuck = Math.min(1, t * 1.5);
      s.heading = from.heading + e * Math.PI * 3;
    });
    s.visible = false;
    s.scale = 1;
    this.shards.burst(center.x, center.y, {
      count: 30,
      colors: [NEON.pink, NEON.cyan, NEON.white],
      speed: [40, 140],
      spread: Math.PI * 2,
      gravity: 0,
      life: [0.25, 0.6],
    });

    const view = this.fx.view;
    const hole = { x: center.x - view.left, y: center.y - view.top };
    const streaks = captureText(this.view.articleElement!, this.fx);
    this.view.element.classList.add('is-warping');
    this.lock = null;
    this.silk = [];
    this.bites.clear();
    this.marks.clear();
    this.warp = new Warp(streaks, center, 'in', this.duration(1.0));
    while (!this.warp.done) await this.nextFrame();
    this.warp = null;
    return hole;
  }

  /** Dead end: climbs back up its thread and the page is pulled away upwards. */
  async retreat(): Promise<Point> {
    const s = this.spider;
    this.follow = false;
    this.lock = null;
    const view = this.fx.view;
    this.ropeAnchor = { x: s.x, y: view.top - 40 };
    s.liftAll();
    await this.tween(0.2, (t) => {
      s.tuck = t;
      s.turnTowards(-Math.PI / 2, 0.5);
    });
    await this.moveTo({ x: s.x, y: view.top - 90 }, this.difficulty.ropeSpeed, { accelerate: true });
    this.ropeAnchor = null;
    s.visible = false;
    const center = { x: (view.left + view.right) / 2, y: view.top };
    const streaks = captureText(this.view.articleElement!, this.fx);
    this.view.element.classList.add('is-warping');
    this.silk = [];
    this.bites.clear();
    this.marks.clear();
    this.warp = new Warp(streaks, center, 'in', this.duration(0.8));
    while (!this.warp.done) await this.nextFrame();
    this.warp = null;
    return { x: center.x - view.left, y: 0 };
  }

  /** Victory dance on the target page. */
  async celebrate(): Promise<void> {
    const s = this.spider;
    const base = { x: s.x, y: s.y };
    this.lock = null;
    for (let i = 0; i < 3; i++) {
      this.shards.burst(base.x, base.y, { count: 40, colors: [NEON.cyan, NEON.pink, NEON.white, '#ffcc4d'], speed: [60, 200], spread: Math.PI * 2, gravity: 90, life: [0.5, 1.2] });
    }
    await this.tween(1.4, (t) => {
      s.heading = t * Math.PI * 4;
      s.scale = 1 + 0.12 * Math.sin(t * Math.PI * 6);
    });
    s.scale = 1;
    s.heading = 0;
  }

  // ------------------------------------------------------------ internals

  private eat(word: HTMLElement, box: Box): void {
    eatWord(word);
    this.bites.add(box, this.frame, word);
    const inLink = !!word.closest('a');
    const c = boxCenter(box);
    this.shards.burst(c.x, c.y, {
      count: 8 + Math.min(14, Math.round((box.right - box.left) / 5)),
      colors: inLink ? [NEON.link, NEON.white, NEON.pink] : [NEON.ink, NEON.white, NEON.cyan, NEON.pink],
    });
  }

  /** Where a foot lands: on a nearby link if there is one (the crawler walks on the web). */
  private footHold(wanted: Point): FootHold {
    const scroller = this.view.scroller;
    const desired = {
      x: Math.min(scroller.scrollWidth - 4, Math.max(4, wanted.x)),
      y: Math.min(scroller.scrollHeight - 4, Math.max(6, wanted.y)),
    };
    let best = -1;
    let bestDistance = 16;
    for (let i = 0; i < this.linkBoxes.length; i++) {
      const box = this.linkBoxes[i];
      if (Math.abs(box.top - desired.y) > 60) continue;
      const d = distanceToBox(desired, box);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    if (best < 0) return { point: desired, link: null };
    const box = this.linkBoxes[best];
    return {
      point: { x: Math.min(box.right - 2, Math.max(box.left + 2, desired.x)), y: (box.top + box.bottom) / 2 },
      link: best,
    };
  }

  private findAnchor(target: LinkTarget): HTMLElement | null {
    const visible = (a: HTMLElement) => a.getClientRects().length > 0;
    const byOrder = this.linkEls[target.order];
    if (byOrder && byOrder.dataset.title === target.linkedTitle && visible(byOrder)) return byOrder;
    return this.linkEls.find((a) => (a.dataset.title === target.linkedTitle || a.dataset.title === target.title) && visible(a)) ?? null;
  }

  /**
   * Box of a link's first line. Once its words are wrapped in spans, a link
   * can report several rects per line, so they are merged.
   */
  private anchorBox(anchor: HTMLElement): Box {
    const rects = Array.from(anchor.getClientRects());
    if (!rects.length) return this.fx.contentBox(anchor);
    const first = rects[0];
    let left = first.left;
    let right = first.right;
    let top = first.top;
    let bottom = first.bottom;
    for (const rect of rects.slice(1)) {
      const cy = (rect.top + rect.bottom) / 2;
      if (cy < first.top || cy > first.bottom) continue; // another line
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    return this.fx.toContent(new DOMRect(left, top, right - left, bottom - top));
  }

  /** Where the spider waits next to the title while it thinks. */
  private restingSpot(): Point {
    const title = this.view.articleElement?.querySelector('.wiki-title');
    if (!title) return { x: 80, y: 50 };
    const box = this.fx.contentBox(title);
    const range = document.createRange();
    range.selectNodeContents(title);
    const rects = range.getClientRects();
    const last = rects.length ? this.fx.toContent(rects[rects.length - 1]) : box;
    const x = Math.min(last.right + 70 * this.spider.size, box.right - 60 * this.spider.size);
    return { x: Math.max(box.left + 40, x), y: (last.top + last.bottom) / 2 };
  }

  private collectLinks(): void {
    this.linkEls = Array.from(this.view.scroller.querySelectorAll<HTMLElement>('a.wiki-link'));
    this.linkBoxes = this.linkEls.map((a) =>
      a.getClientRects().length ? this.anchorBox(a) : { left: -1e6, top: -1e6, right: -1e6, bottom: -1e6 },
    );
  }

  private refreshLayout(): void {
    this.spider.size = Math.max(0.6, Math.min(1, this.fx.width / 760));
    if (!this.view.articleElement) return;
    this.collectLinks();
    this.bites.relayout((word) => this.fx.toContent(word.getClientRects()[0] ?? word.getBoundingClientRect()));
  }

  private duration(seconds: number): number {
    return reducedMotion() ? seconds * 0.4 : seconds;
  }

  private nextFrame(): Promise<number> {
    if (this.closed) return Promise.reject(new PaneClosedError());
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private async wait(seconds: number): Promise<void> {
    let elapsed = 0;
    while (elapsed < seconds) elapsed += await this.nextFrame();
  }

  private async tween(seconds: number, step: (t: number) => void): Promise<void> {
    let elapsed = 0;
    step(0);
    while (elapsed < seconds) {
      elapsed += await this.nextFrame();
      step(Math.min(1, elapsed / seconds));
    }
  }

  /** Moves the body centre to `target` at `speed` CSS px/s. */
  private async moveTo(target: Point, speed: number, options: { walk?: boolean; face?: number; accelerate?: boolean; onStep?: () => void } = {}): Promise<void> {
    const s = this.spider;
    let elapsed = 0;
    try {
      for (;;) {
        const dx = target.x - s.x;
        const dy = target.y - s.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.5) break;
        const dt = await this.nextFrame();
        elapsed += dt;
        const v = options.accelerate ? Math.min(speed, 120 + elapsed * speed * 2.5) : speed;
        const step = Math.min(distance, v * dt);
        s.x += (dx / distance) * step;
        s.y += (dy / distance) * step;
        s.speed = v;
        if (options.walk) s.turnTowards(options.face ?? Math.atan2(dy, dx), 8 * dt);
        options.onStep?.();
      }
    } finally {
      s.speed = 0;
    }
    s.x = target.x;
    s.y = target.y;
  }

  private loop = (now: number): void => {
    if (this.closed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    // Draw what the coroutines prepared last frame, then let them step again.
    // A paused pane is drawn once and then left alone.
    if (this.paused) {
      if (!this.drawnWhilePaused) this.render();
      this.drawnWhilePaused = true;
      return;
    }
    this.drawnWhilePaused = false;
    this.render();
    this.frame++;
    this.time += dt;
    if (this.thinking) this.thinkTime += dt;
    this.spider.update(dt, this.ground);
    this.shards.update(dt);
    this.bites.update(dt);
    this.marks.update(dt);
    this.warp?.update(dt);
    this.indexLinks();
    this.updateCamera(dt);
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve(dt);
  };

  /** Marks links under the scan line (thinking) and under planted feet. */
  private indexLinks(): void {
    if (this.thinking) {
      const y = this.scanY();
      this.linkBoxes.forEach((box, i) => {
        const cy = (box.top + box.bottom) / 2;
        if (cy <= y && cy > y - 14) this.marks.touch(i, box, 1.8);
      });
    }
    for (const i of this.spider.footLinks()) {
      const box = this.linkBoxes[i];
      if (box) this.marks.touch(i, box, 0.45);
    }
  }

  private scanY(): number {
    const view = this.fx.view;
    const period = 1.4;
    return view.top + ((this.thinkTime % period) / period) * (view.bottom - view.top);
  }

  private updateCamera(dt: number): void {
    if (!this.follow) return;
    const scroller = this.view.scroller;
    const target = cameraTarget(this.spider.y, scroller.clientHeight, scroller.scrollHeight);
    this.camY += (target - this.camY) * Math.min(1, dt * 4);
    scroller.scrollTop = this.camY;
  }

  private render(): void {
    const ctx = this.fx.begin();
    const view = this.fx.view;
    if (this.warp) {
      this.warp.draw(ctx, view);
      this.shards.draw(ctx);
      return;
    }
    const s = this.spider;
    this.bites.draw(ctx, view);
    if (this.thinking) drawScan(ctx, view, this.scanY());
    this.marks.draw(ctx, s.visible ? { x: s.x, y: s.y } : null, view);
    if (this.lock) {
      const box = this.anchorBox(this.lock.el);
      const age = this.time - this.lock.since;
      const target = boxCenter(box);
      const distance = Math.hypot(target.x - s.x, target.y - s.y);
      drawBeam(ctx, s.mouth(), { x: box.left, y: target.y }, Math.min(1, age * 4) * Math.min(1, distance / 80));
      drawTargetLock(ctx, box, age, this.lock.label);
    }
    const silk = [...this.silk];
    if (s.visible) {
      if (this.ropeAnchor) silk.push(this.ropeAnchor);
      if (silk.length) silk.push(s.spinneret());
    }
    drawSilk(ctx, silk);
    s.draw(ctx);
    this.shards.draw(ctx);
    if (this.thinking && s.visible) {
      const dots = '.'.repeat(1 + (Math.floor(this.thinkTime * 3) % 3));
      drawLabel(ctx, `INDEXING${dots}`, s.x + 26 * s.size, s.y - 30 * s.size, NEON.cyan);
    }
  }
}
