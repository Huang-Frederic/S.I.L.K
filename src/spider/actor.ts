/**
 * The spider as an actor on the stage. It owns the rig and plays every move
 * as a coroutine (`await this.frame()` per frame):
 *
 *   01 scan        rays from the eye to every visible link, scores pop up
 *   02 crawl & eat walk over the real text, feet on words, jaws strike out
 *                  every word they pass; random destruction on the way
 *                  (eye laser cut, grab & throw, stomp); web zip to far links
 *   03 grab        legs wrap the link, the link lights up, the edges glitch
 *   04 hop         dive into the link, the page glitches out in RGB-split
 *                  slices, the next one glitches in, drop in on silk
 *
 * plus the airborne moves (leap across to another pane, walk to the middle
 * of the screen), the victory dance and the collapse.
 *
 * While the spider stands on a pane its coordinates are that pane's content
 * coordinates (it scrolls with the text); airborne they are stage
 * coordinates. A move can be cut short by `interrupt()` (link snatch): the
 * next frame throws `Interrupted`, except inside sequences marked
 * uninterruptible (page transitions).
 */
import { CYAN, drawLabel, drawLaser, drawSilk, flyWord, LINE, RED, shockwave, snakeCase, strokeBox, type Fragments } from '../fx/fx';
import { captureBars, EdgeGlitch, PageGlitch } from '../fx/glitch';
import { settings } from '../settings';
import type { RacerPane } from '../stage/racerPane';
import { Z, type Box, type Drawable, type Point, type Stage } from '../stage/stage';
import { EATEN_CLASS, type Word } from '../stage/wordIndex';
import type { LoadedArticle } from '../wiki/articles';
import { OPEN_GROUND, SpiderRig, type Foothold, type Ground } from './rig';
import { planWalk } from './route';

export class Interrupted extends Error {
  constructor(readonly reason: string) {
    super(`Interrupted: ${reason}`);
    this.name = 'Interrupted';
  }
}

/** Speeds of the current difficulty (rage included). */
export interface ActorSpeeds {
  /** Crawling speed (px/s). */
  walk: number;
  /** Web zip speed (px/s) and the distance beyond which the spider zips. */
  zip: number;
  zipBeyond: number;
  /** Random destruction moves per second of crawling. */
  mischief: number;
  /** Animation pace: 1 = normal, 2 = twice as fast. */
  pace: number;
}

/** A score shown next to a link at the end of the scan. */
export interface ScoreTag {
  anchor: HTMLAnchorElement;
  score: number;
  tag?: string;
  best?: boolean;
}

interface Overlay {
  until: number;
  draw(ctx: CanvasRenderingContext2D): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const center = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const textOf = (el: Element) => (el.textContent ?? '').replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, 18) || '…';

export class SpiderActor implements Drawable {
  readonly z = Z.spider;
  readonly rig = new SpiderRig();
  /** The pane the spider stands on, or null while airborne. */
  surface: RacerPane | null = null;
  /** Scroll the spider's pane to keep it in view. */
  follow = true;
  /** Greater than zero while an attack holds the spider in place. */
  holds = 0;
  /** False during sequences that must not be cut (page transitions). */
  interruptible = true;
  /** Words destroyed so far (eaten, sliced, thrown, squashed). */
  wordsEaten = 0;
  /** Status line in the spider's pane (`eat("approach") · words_eaten: 37`). */
  status = '';
  onEat: ((total: number) => void) | null = null;

  private interruptReason: string | null = null;
  /** Dragline behind the spider (surface coordinates). */
  private trail: Point[] = [];
  private hangFrom: Point | null = null;
  private zipLine: { from: Point; to: Point; t: number } | null = null;
  private rays: Array<{ to: Point; age: number }> = [];
  private overlays: Overlay[] = [];
  private lockOn: { anchor: HTMLAnchorElement; text: string } | null = null;
  private flash: { text: string; until: number } | null = null;
  private edges: EdgeGlitch | null = null;
  private camY = 0;
  private readonly ground: Ground = { hold: (p) => this.footHold(p) };
  private readonly removeFromStage: () => void;

  constructor(
    readonly stage: Stage,
    private readonly fragments: Fragments,
    private readonly speeds: () => ActorSpeeds,
  ) {
    this.rig.visible = false;
    this.removeFromStage = stage.add(this);
  }

  destroy(): void {
    this.removeFromStage();
    this.edges && (this.edges.active = false);
  }

  // ------------------------------------------------------------- coroutines

  /** Next frame (dt in seconds). Throws `Interrupted` when asked to stop. */
  async frame(): Promise<number> {
    const dt = await this.stage.frame();
    if (this.interruptReason && this.interruptible) {
      const reason = this.interruptReason;
      this.interruptReason = null;
      throw new Interrupted(reason);
    }
    return dt;
  }

  interrupt(reason: string): void {
    this.interruptReason = reason;
  }

  clearInterrupt(): void {
    this.interruptReason = null;
  }

  async wait(seconds: number): Promise<void> {
    let elapsed = 0;
    while (elapsed < seconds) elapsed += await this.frame();
  }

  async tween(seconds: number, step: (t: number) => void): Promise<void> {
    let elapsed = 0;
    step(0);
    while (elapsed < seconds) {
      elapsed += await this.frame();
      step(Math.min(1, elapsed / Math.max(1e-6, seconds)));
    }
  }

  /** Awaits a promise frame by frame, so that interrupts still get through. */
  async until<T>(promise: Promise<T>): Promise<T> {
    const box: { done?: { ok: true; value: T } | { ok: false; error: unknown } } = {};
    promise.then(
      (value) => (box.done = { ok: true, value }),
      (error) => (box.done = { ok: false, error }),
    );
    while (!box.done) await this.frame();
    const done = box.done as { ok: true; value: T } | { ok: false; error: unknown };
    if (!done.ok) throw done.error;
    return done.value;
  }

  private get pace(): number {
    return this.speeds().pace;
  }

  /** Duration of an animation, scaled by the pace and Reduce motion. */
  private d(seconds: number): number {
    return settings.duration(seconds) / this.pace;
  }

  /** Forgets half-finished moves (after an interrupt). */
  resetPose(): void {
    const rig = this.rig;
    rig.pose = 'stand';
    rig.fold = 0;
    rig.carried = null;
    rig.grabBox = null;
    rig.scale = 1;
    rig.tilt = 0;
    this.zipLine = null;
    this.hangFrom = null;
    this.rays = [];
    this.lockOn = null;
    this.stopEdges();
    if (this.surface && rig.visible) rig.plantAll(this.ground);
  }

  // ------------------------------------------------------------- positions

  /** A point of the spider's space in stage coordinates. */
  toStage(p: Point): Point {
    return this.surface ? this.surface.toStage(p) : p;
  }

  eyeOnStage(): Point {
    return this.toStage(this.rig.eye());
  }

  bodyOnStage(): Point {
    return this.toStage({ x: this.rig.x, y: this.rig.y });
  }

  spinneretOnStage(): Point {
    return this.toStage(this.rig.spinneret());
  }

  get visible(): boolean {
    return this.rig.visible;
  }

  /** Moves into a pane's content coordinates (from wherever it is). */
  enterSurface(pane: RacerPane): void {
    const stagePoint = this.bodyOnStage();
    const p = pane.fromStage(stagePoint);
    this.rig.x = p.x;
    this.rig.y = p.y;
    this.surface = pane;
    this.trail = [];
    this.camY = pane.scroller.scrollTop;
  }

  /** Leaves its pane: from now on it lives in stage coordinates. */
  leaveSurface(): void {
    if (!this.surface) return;
    const p = this.bodyOnStage();
    this.rig.x = p.x;
    this.rig.y = p.y;
    this.rig.liftAll();
    this.surface = null;
    this.trail = [];
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.rig.update(dt, this.surface ? this.ground : OPEN_GROUND);
    for (const ray of this.rays) ray.age += dt;
    this.rays = this.rays.filter((r) => r.age < 0.45);
    this.overlays = this.overlays.filter((o) => o.until > this.stage.time);
    this.updateCamera(dt);
    // Dragline: a point every few pixels while walking.
    if (this.surface && this.rig.grounded && this.rig.visible) {
      const last = this.trail[this.trail.length - 1];
      const here = { x: this.rig.x, y: this.rig.y + 16 };
      if (!last || distance(last, here) > 9) {
        this.trail.push(here);
        if (this.trail.length > 70) this.trail.shift();
      }
    }
  }

  private updateCamera(dt: number): void {
    const pane = this.surface;
    if (!pane || !this.follow || pane.owner !== 'spider' || !this.rig.visible) return;
    const sc = pane.scroller;
    const max = sc.scrollHeight - sc.clientHeight;
    if (max <= 0) return;
    if (Math.abs(this.camY - sc.scrollTop) > 2) this.camY = sc.scrollTop;
    const target = clamp(this.rig.y - sc.clientHeight * 0.42, 0, max);
    this.camY += (target - this.camY) * (1 - Math.exp(-dt * (this.zipLine ? 12 : 4.5)));
    const rounded = Math.round(this.camY);
    if (rounded !== sc.scrollTop) sc.scrollTop = rounded;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const pane = this.surface;
    const rig = this.rig;
    ctx.save();
    if (pane) pane.enterContent(ctx, true);

    // Scan rays.
    if (this.rays.length) {
      const eye = rig.eye();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1;
      for (const ray of this.rays) {
        ctx.globalAlpha = 0.75 * (1 - ray.age / 0.45);
        ctx.beginPath();
        ctx.moveTo(eye.x, eye.y);
        ctx.lineTo(ray.to.x, ray.to.y);
        ctx.stroke();
        ctx.fillStyle = RED;
        ctx.fillRect(ray.to.x - 1.5, ray.to.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    }

    if (rig.visible) {
      if (this.trail.length > 1) drawSilk(ctx, [...this.trail, { x: rig.x, y: rig.y + 16 }], 0.4);
      if (this.hangFrom) drawSilk(ctx, [this.hangFrom, rig.top()], 0.85);
    }
    if (this.zipLine) {
      const { from, to, t } = this.zipLine;
      const end = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
      drawSilk(ctx, [from, end], 0.9);
    }
    rig.draw(ctx);
    ctx.restore();

    // Labels in stage coordinates.
    for (const overlay of this.overlays) {
      ctx.save();
      overlay.draw(ctx);
      ctx.restore();
    }
    if (this.lockOn && pane && this.lockOn.anchor.isConnected) {
      const box = pane.boxToStage(pane.linkBox(this.lockOn.anchor));
      strokeBox(ctx, box, RED, { dash: [4, 3], pad: 3 });
      drawLabel(ctx, this.lockOn.text, Math.min(box.right + 14, pane.rect.right - 8 - this.lockOn.text.length * 7), box.top - 16, RED);
    }
    if (pane && pane.owner === 'spider') {
      const x = pane.rect.left + 22;
      const y = pane.rect.bottom - 18;
      if (this.flash && this.flash.until > this.stage.time) drawLabel(ctx, this.flash.text, x, y, RED, { fill: true });
      else if (this.status) drawLabel(ctx, this.status, x, y, RED, { boxed: false });
    }
  }

  private addOverlay(seconds: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
    this.overlays.push({ until: this.stage.time + seconds, draw });
  }

  /** A short label next to the spider (e.g. `yeet()`). */
  sayLabel(text: string, color = CYAN, seconds = 0.8): void {
    const at = this.bodyOnStage();
    this.addOverlay(seconds, (ctx) => drawLabel(ctx, text, at.x + 34, at.y - 58, color, { boxed: false }));
  }

  /** Big red filled label in the pane's corner (`+1 HOP · hops: 7`). */
  flashStatus(text: string, seconds = 1.4): void {
    this.flash = { text, until: this.stage.time + seconds };
  }

  // ------------------------------------------------------------------ ground

  /** Feet snap to the nearest word; on bare paper they land where they aim. */
  private footHold(desired: Point): Foothold {
    const pane = this.surface;
    if (!pane) return { point: desired, word: null };
    const article = pane.articleBox();
    const view = pane.visibleContent();
    const p = {
      x: clamp(desired.x, (article?.left ?? view.left) - 6, (article?.right ?? view.right) + 6),
      y: clamp(desired.y, (article?.top ?? view.top) + 4, (article?.bottom ?? view.bottom) - 4),
    };
    pane.words.ensure({ left: p.x - 140, right: p.x + 140, top: p.y - 100, bottom: p.y + 100 });
    const word = pane.words.nearest(p, this.rig.reach * 0.32);
    if (!word) return { point: p, word: null };
    const b = word.box;
    return { point: { x: clamp(p.x, b.left + 3, b.right - 3), y: b.top + (b.bottom - b.top) * 0.62 }, word };
  }

  // --------------------------------------------------------------- damage

  /** Destroys a word of the current pane and counts it. */
  destroyWord(word: Word, kind: 'eaten' | 'hole' | 'squashed' = 'eaten'): void {
    if (word.gone) return;
    word.gone = true;
    word.el.classList.add(kind === 'eaten' ? EATEN_CLASS : `sw-${kind}`);
    const pane = this.surface;
    if (word.link && pane) pane.damageLink(word.link, 'eaten');
    this.wordsEaten++;
    this.onEat?.(this.wordsEaten);
    if (kind === 'eaten' && pane) {
      this.fragments.burst(pane.toStage(center(word.box)), { count: 5, colors: [RED, LINE], speed: [12, 46], life: [0.2, 0.32], gravity: 30 });
    }
  }

  /** Eats the word under the jaws (the body's centre). */
  private eatUnderJaws(exclude: HTMLAnchorElement | null): void {
    const pane = this.surface;
    if (!pane) return;
    const word = pane.words.nearest({ x: this.rig.x, y: this.rig.y }, 1.5, (w) => !w.gone && (!exclude || w.link !== exclude));
    if (!word) return;
    this.destroyWord(word);
    this.status = `eat("${textOf(word.el)}") · words_eaten: ${this.wordsEaten}`;
  }

  /** Words crossed by a segment (content coordinates), nearest first. */
  private wordsAlong(from: Point, to: Point, exclude: HTMLAnchorElement | null): Word[] {
    const pane = this.surface;
    if (!pane) return [];
    const box = { left: Math.min(from.x, to.x), right: Math.max(from.x, to.x), top: Math.min(from.y, to.y), bottom: Math.max(from.y, to.y) };
    pane.words.ensure(box);
    const hits = pane.words.inside(box, (w) => !w.gone && (!exclude || w.link !== exclude) && segmentHitsBox(from, to, w.box));
    return hits.sort((a, b) => distance(from, center(a.box)) - distance(from, center(b.box)));
  }

  /** The eye laser cuts a word in half: the halves fly apart, sparks at the cut. */
  sliceWord(word: Word): void {
    const pane = this.surface;
    if (!pane || word.gone) return;
    const style = getComputedStyle(word.el);
    const font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const color = style.color;
    const text = word.el.textContent ?? '';
    const box = { ...word.box };
    const cut = 0.35 + Math.random() * 0.3;
    const generation = pane.generation;
    this.destroyWord(word);
    let t = 0;
    const life = 0.8;
    this.stage.add({
      z: Z.projectiles,
      update: (dt) => {
        t += dt;
        return t < life && pane.generation === generation;
      },
      draw: (ctx) => {
        pane.enterContent(ctx);
        const w = box.right - box.left;
        const cx = box.left + w * cut;
        const cy = (box.top + box.bottom) / 2;
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        for (const half of [-1, 1] as const) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - t / life);
          ctx.translate(cx + half * (4 + 46 * t), cy - 18 * t + 70 * t * t);
          ctx.rotate(half * 0.7 * t);
          ctx.beginPath();
          if (half < 0) ctx.rect(-w * cut - 4, -30, w * cut + 4, 60);
          else ctx.rect(0, -30, w * (1 - cut) + 4, 60);
          ctx.clip();
          ctx.fillText(text, -w * cut, 1);
          ctx.restore();
        }
        if (t < 0.14) {
          ctx.strokeStyle = RED;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 1 - t / 0.14;
          ctx.beginPath();
          ctx.moveTo(cx - 3, box.top - 4);
          ctx.lineTo(cx + 3, box.bottom + 4);
          ctx.stroke();
        }
      },
    });
    const at = pane.toStage({ x: box.left + (box.right - box.left) * cut, y: (box.top + box.bottom) / 2 });
    this.fragments.burst(at, { count: 12, colors: [RED, '#FFD6DA', LINE], speed: [30, 120], life: [0.15, 0.35], gravity: 140 });
  }

  /** A beam from the eye to a point of the current space. */
  private beam(to: () => Point, seconds: number, width = 2): void {
    const start = this.stage.time;
    this.addOverlay(seconds, (ctx) => {
      const u = (this.stage.time - start) / seconds;
      drawLaser(ctx, this.eyeOnStage(), this.toStage(to()), 1 - u * u, width);
    });
  }

  // ------------------------------------------------------------ 01 · scan

  /** Drops in on a silk thread near the top of a freshly shown article. */
  async dropIn(pane: RacerPane): Promise<void> {
    const rig = this.rig;
    this.surface = pane;
    this.trail = [];
    this.camY = pane.scroller.scrollTop;
    const spot = this.landingSpot(pane);
    const view = pane.visibleContent();
    const startY = view.top - 70;
    rig.x = spot.x;
    rig.y = startY;
    rig.scale = 1;
    rig.tilt = 0;
    rig.pose = 'hang';
    rig.fold = 0.5;
    rig.liftAll();
    rig.visible = true;
    this.hangFrom = { x: spot.x, y: view.top - 2 };
    await this.tween(this.d(0.45), (t) => (rig.y = lerp(startY, spot.y, easeOutBack(t))));
    rig.pose = 'stand';
    rig.plantAll(this.ground);
    await this.tween(this.d(0.14), (t) => (rig.fold = 0.5 * (1 - t)));
    this.trail = [this.hangFrom, { x: spot.x, y: spot.y + 16 }];
    this.hangFrom = null;
  }

  private landingSpot(pane: RacerPane): Point {
    const view = pane.visibleContent();
    const article = pane.articleElement;
    const para = article ? Array.from(article.querySelectorAll('p')).find((p) => (p.textContent ?? '').trim().length > 40) : null;
    const rect = para?.getClientRects()[0];
    if (rect) {
      const box = pane.toContent(rect);
      if (box.top < view.bottom - 60) return { x: box.left + Math.min(150, (box.right - box.left) * 0.3), y: (box.top + box.bottom) / 2 };
    }
    return { x: (view.left + view.right) / 2, y: view.top + 160 };
  }

  /**
   * Fires rays at the visible links until `work` (the decision) is ready and
   * at least `minSeconds` have passed.
   */
  async scan<T>(work: Promise<T>, minSeconds: number, linkCount: number): Promise<T> {
    const pane = this.surface;
    if (!pane) return this.until(work);
    const links = pane.visibleLinks(() => true).filter((l) => !l.el.dataset.decoy);
    for (let i = links.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [links[i], links[j]] = [links[j], links[i]];
    }
    this.status = `scanning ${linkCount} links…`;
    const box: { done?: boolean } = {};
    work.then(
      () => (box.done = true),
      () => (box.done = true),
    );
    let elapsed = 0;
    let next = 0;
    let i = 0;
    const gap = clamp(minSeconds / Math.max(8, links.length), 0.035, 0.14);
    while (elapsed < minSeconds || !box.done) {
      const dt = await this.frame();
      elapsed += dt;
      next -= dt;
      if (next <= 0 && links.length) {
        const to = center(links[i++ % links.length].box);
        this.rays.push({ to, age: 0 });
        this.rig.lookAt = to;
        next = gap;
      }
    }
    return this.until(work);
  }

  /** Score labels next to the shortlisted links; the best one in cyan. */
  async showScores(tags: ScoreTag[], seconds: number): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const view = pane.visibleContent();
    const shown = tags.filter((t) => {
      if (!t.anchor.isConnected || !t.anchor.getClientRects().length) return false;
      const b = pane.linkBox(t.anchor);
      return b.bottom > view.top && b.top < view.bottom;
    });
    if (!shown.length) return;
    for (const tag of shown) this.rays.push({ to: center(pane.linkBox(tag.anchor)), age: 0.1 });
    this.addOverlay(this.d(seconds), (ctx) => {
      for (const tag of shown) {
        if (!tag.anchor.isConnected) continue;
        const b = pane.boxToStage(pane.linkBox(tag.anchor));
        const text = tag.tag ? `${tag.score.toFixed(2)} ${tag.tag}` : tag.score.toFixed(2);
        if (tag.best) {
          strokeBox(ctx, b, CYAN, { pad: 4, glow: true });
          drawLabel(ctx, text, b.left - 4, b.bottom + 16, CYAN);
        } else {
          drawLabel(ctx, text, b.left - 2, b.top - 13, LINE, { boxed: false });
        }
      }
    });
    await this.wait(this.d(seconds));
  }

  /** The eye laser locks the chosen link, slicing words on the way. */
  async lock(anchor: HTMLAnchorElement, title: string): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const box = pane.linkBox(anchor);
    const to = center(box);
    this.rig.lookAt = to;
    this.lockOn = { anchor, text: `LOCK ${snakeCase(title)}` };
    this.status = `eye.laser(link) → lock`;
    for (const word of this.wordsAlong(this.rig.eye(), to, anchor).slice(0, 2)) this.sliceWord(word);
    this.beam(() => center(pane.linkBox(anchor)), this.d(0.4));
    this.fragments.burst(pane.toStage(to), { count: 8, colors: [RED, LINE], speed: [20, 70], life: [0.15, 0.3], gravity: 60 });
    await this.wait(this.d(0.34));
  }

  // ------------------------------------------------------- 02 · crawl & eat

  /** Walks (or zips) to the link's line, then eats its way along it to the link. */
  async crawlTo(anchor: HTMLAnchorElement): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const box = pane.linkBox(anchor);
    pane.words.ensure({ left: box.left - 600, right: box.right + 600, top: box.top - 40, bottom: box.bottom + 40 });
    const tolerance = Math.max(6, (box.bottom - box.top) * 0.5);
    const line = pane.words
      .inside({ left: -1e6, right: 1e6, top: (box.top + box.bottom) / 2 - tolerance, bottom: (box.top + box.bottom) / 2 + tolerance }, (w) => !w.gone && w.link !== anchor)
      .map((w) => w.box);
    const before = line.filter((b) => b.right <= box.left + 1).sort((a, b) => a.left - b.left);
    const after = line.filter((b) => b.left >= box.right - 1).sort((a, b) => a.left - b.left);
    const plan = planWalk(box, before, after, 15, 5);
    const here = { x: this.rig.x, y: this.rig.y };
    const onLine = Math.abs(here.y - plan.start.y) < 6 && (plan.direction === 1 ? here.x >= plan.start.x - 4 && here.x <= plan.end.x : here.x <= plan.start.x + 4 && here.x >= plan.end.x);
    if (!onLine) {
      if (distance(here, plan.start) > this.speeds().zipBeyond) await this.webZip(plan.start, center(box));
      else await this.walk(plan.start, anchor, true);
    }
    await this.walk(plan.end, anchor, false);
  }

  /** Walks in a straight line, eating every word under its jaws. */
  private async walk(to: Point, exclude: HTMLAnchorElement | null, mischief: boolean): Promise<void> {
    const rig = this.rig;
    let speed = 0;
    for (;;) {
      const dt = await this.frame();
      if (this.holds > 0) {
        speed = 0;
        continue;
      }
      const sp = this.speeds();
      const dx = to.x - rig.x;
      const dy = to.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.6) break;
      speed = Math.min(sp.walk, speed + sp.walk * dt * 5);
      const v = Math.min(speed, Math.max(sp.walk * 0.3, d * 5));
      const stepLength = Math.min(d, v * dt);
      rig.x += (dx / d) * stepLength;
      rig.y += (dy / d) * stepLength;
      rig.lookAt = to;
      this.eatUnderJaws(exclude);
      if (mischief && d > 60 && Math.random() < sp.mischief * dt) await this.mischief(exclude);
    }
  }

  /** web.shoot(link).zip(): a silk line to the link, then one long jump along it. */
  private async webZip(to: Point, aim: Point): Promise<void> {
    const rig = this.rig;
    const from = { x: rig.x, y: rig.y };
    this.status = 'web.shoot(link).zip()';
    this.zipLine = { from: { ...from }, to: aim, t: 0 };
    await this.tween(this.d(0.16), (t) => this.zipLine && (this.zipLine.t = t));
    const mid = this.toStage({ x: lerp(from.x, aim.x, 0.5), y: lerp(from.y, aim.y, 0.5) });
    this.addOverlay(0.5, (ctx) => drawLabel(ctx, 'zip →', mid.x + 10, mid.y - 10, LINE, { boxed: false }));
    rig.liftAll();
    rig.fold = 0.55;
    const seconds = clamp(distance(from, to) / this.speeds().zip, 0.16, 0.8);
    try {
      await this.tween(seconds, (t) => {
        const e = easeInOut(t);
        rig.x = lerp(from.x, to.x, e);
        rig.y = lerp(from.y, to.y, e);
        if (this.zipLine) this.zipLine.from = { x: rig.x, y: rig.y };
      });
    } finally {
      this.zipLine = null;
      rig.fold = 0;
    }
    rig.plantAll(this.ground);
    this.trail = [from, { x: rig.x, y: rig.y + 16 }];
  }

  // ---------------------------------------------------------- mischief

  /** A random destruction move while crawling. */
  private async mischief(exclude: HTMLAnchorElement | null): Promise<void> {
    const r = Math.random();
    if (r < 0.4) await this.yeet(exclude);
    else if (r < 0.72) await this.stomp(exclude);
    else await this.laserCut(exclude);
  }

  /** grab(word).throw(): a front leg plucks a word and flings it off the page. */
  async yeet(exclude: HTMLAnchorElement | null = null): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const rig = this.rig;
    const word = pane.words.nearest({ x: rig.x, y: rig.y - 30 }, rig.reach * 0.7, (w) => !w.gone && w.link !== exclude && (w.el.textContent?.length ?? 0) >= 3);
    if (!word) return;
    const text = textOf(word.el);
    const side: 1 | -1 = center(word.box).x >= rig.x ? 1 : -1;
    this.destroyWord(word, 'hole');
    rig.carried = { text, side };
    this.status = `grab("${text}").throw()`;
    await this.wait(this.d(0.24));
    const from = this.toStage(rig.carryPoint(side));
    rig.carried = null;
    const away = { x: from.x + side * 260, y: from.y - 190 - Math.random() * 80 };
    this.addOverlay(0.7, (ctx) => drawLabel(ctx, 'yeet()', from.x + side * 40, from.y - 30, CYAN, { boxed: false }));
    void flyWord(this.stage, { text, from: () => from, to: () => away, duration: 0.55, arc: 30, spin: 9 * side, away: true });
    await this.wait(this.d(0.12));
  }

  /** stomp(word): a foot slams a short word flat. */
  async stomp(exclude: HTMLAnchorElement | null = null): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const rig = this.rig;
    const word = pane.words.nearest({ x: rig.x, y: rig.y + 26 }, rig.reach * 0.65, (w) => !w.gone && w.link !== exclude && (w.el.textContent?.length ?? 9) <= 5);
    if (!word) return;
    this.status = `stomp("${textOf(word.el)}")`;
    await this.tween(this.d(0.08), (t) => (rig.scale = 1 + 0.08 * t));
    this.destroyWord(word, 'squashed');
    const spot = center(word.box);
    shockwave(this.stage, () => pane.toStage(spot));
    this.stage.shake(3.5);
    await this.tween(this.d(0.1), (t) => (rig.scale = 1.08 - 0.08 * t));
    await this.wait(this.d(0.1));
  }

  /** eye.laser(word) → cut. */
  async laserCut(exclude: HTMLAnchorElement | null = null): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const rig = this.rig;
    const eye = rig.eye();
    pane.words.ensure({ left: eye.x - 260, right: eye.x + 260, top: eye.y - 200, bottom: eye.y + 200 });
    const options = pane.words.inside({ left: eye.x - 240, right: eye.x + 240, top: eye.y - 180, bottom: eye.y + 180 }, (w) => {
      const d = distance(eye, center(w.box));
      return !w.gone && w.link !== exclude && d > 70 && (w.el.textContent?.length ?? 0) >= 4;
    });
    const word = options[Math.floor(Math.random() * options.length)];
    if (!word) return;
    const to = center(word.box);
    rig.lookAt = to;
    this.status = `eye.laser("${textOf(word.el)}") → cut`;
    this.beam(() => to, this.d(0.26));
    await this.wait(this.d(0.08));
    this.sliceWord(word);
    await this.wait(this.d(0.16));
  }

  // ------------------------------------------------------------ 03 · grab

  /** Wraps the legs around the link; the link lights up and the edges glitch. */
  async grab(anchor: HTMLAnchorElement, title: string, seconds: number, ready?: Promise<unknown>): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const rig = this.rig;
    const box = pane.linkBox(anchor);
    const c = center(box);
    this.lockOn = null;
    rig.pose = 'grab';
    rig.grabBox = box;
    anchor.classList.add('is-grabbed');
    this.status = `LOCKED · ${snakeCase(title)}`;
    this.startEdges(pane);
    const from = { x: rig.x, y: rig.y };
    await this.tween(this.d(0.12), (t) => {
      rig.x = lerp(from.x, c.x, t);
      rig.y = lerp(from.y, c.y, t);
    });
    await this.wait(this.d(seconds));
    if (ready) await this.until(ready);
  }

  private startEdges(pane: RacerPane): void {
    this.stopEdges();
    this.edges = new EdgeGlitch(() => pane.rect);
    this.stage.add(this.edges);
  }

  private stopEdges(): void {
    if (this.edges) this.edges.active = false;
    this.edges = null;
  }

  // ------------------------------------------------------------- 04 · hop

  /** Slides into the link and vanishes. */
  async dive(anchor: HTMLAnchorElement | null): Promise<void> {
    const pane = this.surface;
    const rig = this.rig;
    const c = pane && anchor?.isConnected ? center(pane.linkBox(anchor)) : { x: rig.x, y: rig.y };
    const ring = this.toStage(c);
    const start = this.stage.time;
    this.addOverlay(0.35, (ctx) => {
      const u = (this.stage.time - start) / 0.35;
      ctx.strokeStyle = CYAN;
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, 6 + 40 * u, 0, Math.PI * 2);
      ctx.stroke();
    });
    const from = { x: rig.x, y: rig.y };
    await this.tween(this.d(0.2), (t) => {
      rig.scale = 1 - t;
      rig.x = lerp(from.x, c.x, t);
      rig.y = lerp(from.y, c.y, t);
    });
    rig.visible = false;
    rig.scale = 1;
    rig.pose = 'stand';
    rig.grabBox = null;
    anchor?.classList.remove('is-grabbed');
    this.stopEdges();
    this.trail = [];
  }

  /**
   * Swaps the article of a pane with a glitch: the old text tears into
   * RGB-split slices and vanishes, `render` puts the new article in place,
   * and the new text glitches in.
   */
  async glitchTo(pane: RacerPane, loaded: LoadedArticle): Promise<void> {
    const old = pane.articleElement;
    if (old) {
      const done = PageGlitch.play(this.stage, pane, captureBars(old, pane), 'out', 0.36 / this.pace);
      // Hide the real text only once the first glitch frame is on screen.
      await this.stage.frame();
      pane.setHidden(true);
      await done;
    }
    pane.setHidden(true);
    pane.showArticle(loaded);
    this.camY = 0;
    const fresh = pane.articleElement;
    if (fresh) await PageGlitch.play(this.stage, pane, captureBars(fresh, pane), 'in', 0.36 / this.pace);
    pane.setHidden(false);
  }

  /** Glitches the pane to a new article, then drops in on silk. */
  async enterPage(pane: RacerPane, loaded: LoadedArticle): Promise<void> {
    const was = this.interruptible;
    this.interruptible = false;
    try {
      this.rays = [];
      this.lockOn = null;
      this.status = '';
      await this.glitchTo(pane, loaded);
      await this.dropIn(pane);
    } finally {
      this.interruptible = was;
    }
  }

  /** Dead end: climbs back up its thread and out of the page. */
  async climbOut(): Promise<void> {
    const pane = this.surface;
    if (!pane) return;
    const rig = this.rig;
    const top = pane.visibleContent().top - 80;
    this.hangFrom = { x: rig.x, y: top + 76 };
    rig.pose = 'hang';
    rig.liftAll();
    rig.fold = 0.5;
    const from = rig.y;
    await this.tween(this.d(0.5), (t) => (rig.y = lerp(from, top, t * t)));
    rig.visible = false;
    this.hangFrom = null;
    rig.pose = 'stand';
    rig.fold = 0;
  }

  // ---------------------------------------------------------- airborne

  /** Jumps through the air to a point of a pane (content coordinates). */
  async leapTo(pane: RacerPane, target: () => Point, seconds = 0.4): Promise<void> {
    const rig = this.rig;
    this.leaveSurface();
    this.lockOn = null;
    rig.pose = 'stand';
    rig.grabBox = null;
    rig.fold = 0.6;
    const from = { x: rig.x, y: rig.y };
    const onStage = () => pane.toStage(target());
    this.zipLine = { from: { ...from }, to: onStage(), t: 0 };
    try {
      await this.tween(0.08, (t) => this.zipLine && Object.assign(this.zipLine, { t, to: onStage() }));
      await this.tween(settings.duration(seconds), (t) => {
        const e = easeInOut(t);
        const b = onStage();
        rig.x = lerp(from.x, b.x, e);
        rig.y = lerp(from.y, b.y, e) - Math.sin(Math.PI * t) * 90;
        if (this.zipLine) Object.assign(this.zipLine, { from: { x: rig.x, y: rig.y }, to: b });
      });
    } finally {
      this.zipLine = null;
      rig.fold = 0;
    }
    this.enterSurface(pane);
  }

  /** Legs wrapped around a link (snatch). */
  hug(anchor: HTMLAnchorElement): void {
    if (!this.surface) return;
    this.rig.pose = 'grab';
    this.rig.grabBox = this.surface.linkBox(anchor);
  }

  /** Back on its feet after a leap. */
  land(): void {
    this.rig.pose = 'stand';
    this.rig.grabBox = null;
    if (this.surface) this.rig.plantAll(this.ground);
  }

  /** Plucks a word near the spider (leaving a dashed hole) and returns it. */
  pluckWord(): string | null {
    const pane = this.surface;
    if (!pane || !this.rig.visible) return null;
    const word = pane.words.nearest({ x: this.rig.x, y: this.rig.y }, this.rig.reach, (w) => !w.gone && (w.el.textContent?.length ?? 0) >= 3);
    if (!word) return null;
    const text = textOf(word.el);
    this.destroyWord(word, 'hole');
    return text;
  }

  /** Counts words destroyed by someone else (the mini-spiders). */
  countEaten(n: number): void {
    this.wordsEaten += n;
    this.onEat?.(this.wordsEaten);
  }

  /** Eats a whole link (snatch): every word of it, for good. */
  chompLink(anchor: HTMLAnchorElement): void {
    const pane = this.surface;
    if (!pane) return;
    const box = pane.linkBox(anchor);
    pane.words.ensure({ left: box.left - 10, right: box.right + 10, top: box.top - 10, bottom: box.bottom + 10 });
    for (const word of pane.words.wordsOf(anchor)) this.destroyWord(word);
    pane.damageLink(anchor, 'eaten');
    this.fragments.burst(pane.toStage(center(box)), { count: 26, colors: [RED, LINE, '#88A3E8'], speed: [40, 150], life: [0.25, 0.5], gravity: 160 });
    this.stage.shake(3);
  }

  async wiggle(seconds = 0.45): Promise<void> {
    this.rig.wiggle(seconds);
    await this.wait(seconds);
  }

  /** Walks across the screen (stage coordinates), legs stepping on thin air. */
  async walkOnStage(to: Point, speed: number): Promise<void> {
    const rig = this.rig;
    this.leaveSurface();
    rig.pose = 'stand';
    rig.grabBox = null;
    rig.visible = true;
    rig.plantAll(OPEN_GROUND);
    let v = 0;
    for (;;) {
      const dt = await this.stage.frame();
      const dx = to.x - rig.x;
      const dy = to.y - rig.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) break;
      v = Math.min(speed, v + speed * dt * 4);
      const step = Math.min(d, Math.min(v, Math.max(speed * 0.3, d * 4)) * dt);
      rig.x += (dx / d) * step;
      rig.y += (dy / d) * step;
    }
  }

  /** Shoots silk at a screen element and reels it in to its jaws. */
  async reelIn(element: HTMLElement, label: string, color: string): Promise<void> {
    const rect = element.getBoundingClientRect();
    const from = this.stage.fromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.zipLine = { from: { x: this.rig.x, y: this.rig.y }, to: from, t: 0 };
    await this.stage.tween(0.14, (t) => this.zipLine && (this.zipLine.t = t));
    element.classList.add('is-eaten');
    const jaws = () => ({ x: this.rig.x, y: this.rig.y - 4 });
    const start = { ...from };
    let p = { ...from };
    this.addOverlay(0.45, (ctx) => {
      ctx.font = '700 13px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = color;
      ctx.fillRect(p.x - w / 2, p.y - 12, w, 24);
      ctx.fillStyle = '#101418';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, p.y + 1);
    });
    await this.stage.tween(0.4, (t) => {
      const e = t * t;
      const j = jaws();
      p = { x: lerp(start.x, j.x, e), y: lerp(start.y, j.y, e) - Math.sin(Math.PI * t) * 30 };
      if (this.zipLine) this.zipLine.to = p;
    });
    this.zipLine = null;
    this.fragments.burst(jaws(), { count: 30, colors: [color, LINE], speed: [40, 160], life: [0.3, 0.6], gravity: 120 });
    this.stage.shake(4);
    this.rig.wiggle(0.3);
  }

  /** Victory dance: legs tap in rhythm, the eye blinks. */
  async dance(seconds: number): Promise<void> {
    this.rig.pose = 'dance';
    await this.stage.wait(seconds);
  }

  /** Defeat: legs curl, the body tips over, the eye flickers out. */
  async collapse(dramatic: boolean): Promise<void> {
    const rig = this.rig;
    this.interruptible = false;
    this.zipLine = null;
    this.hangFrom = null;
    this.rays = [];
    this.lockOn = null;
    this.stopEdges();
    if (!rig.visible) return;
    rig.pose = 'collapse';
    rig.grabBox = null;
    rig.carried = null;
    const y = rig.y;
    await this.stage.tween(settings.duration(dramatic ? 0.7 : 0.45), (t) => {
      rig.tilt = (dramatic ? 0.42 : 0.2) * easeOutBack(t);
      rig.y = y + 12 * t;
    });
    if (dramatic) this.stage.shake(5);
    const flicker = dramatic ? [0.1, 1, 0, 0.8, 0, 0.5, 0.05, 0.3, 0, 0.12, 0] : [0.4, 0.8, 0.2, 0];
    for (const open of flicker) {
      rig.eyeOpen = open;
      await this.stage.wait(0.08);
    }
    rig.eyeOpen = 0;
    rig.rage = false;
  }
}

/** True when the segment a-b crosses (or touches) the box. */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  // Liang-Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}
