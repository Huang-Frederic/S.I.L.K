/**
 * Page transitions in the mockups' style: the text of a page is captured as
 * flat bars (one per line fragment: grey text, blue links, light title), and
 * those bars are torn into horizontal slices that slide apart with an RGB
 * split (a red copy to the left, a cyan copy to the right) while the page
 * glitches out, or slide back together while the next page glitches in.
 */
import { settings } from '../settings';
import type { Box, Drawable, Stage } from '../stage/stage';
import { Z } from '../stage/stage';
import { CYAN, RED } from './fx';

export interface Bar {
  /** Content coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** Something with content coordinates that can be drawn into (a pane). */
export interface GlitchSurface {
  readonly rect: Box;
  readonly scroller: HTMLElement;
  enterContent(ctx: CanvasRenderingContext2D, clip?: boolean): void;
  toContent(rect: DOMRect | DOMRectReadOnly): Box;
  visibleContent(): Box;
}

const TEXT = '#3A434E';
const LINK = '#88A3E8';
const TITLE = '#C8CED6';
const MAX_BARS = 1400;

/** Captures the visible text of `root` as bars (content coordinates). */
export function captureBars(root: Element, surface: GlitchSurface): Bar[] {
  const view = surface.visibleContent();
  const bars: Bar[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node && bars.length < MAX_BARS; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) continue;
    const color = parent.closest('a') ? LINK : parent.closest('h1, h2, h3') ? TITLE : TEXT;
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1) continue;
      const box = surface.toContent(rect);
      if (box.bottom < view.top || box.top > view.bottom) continue;
      const h = Math.max(3, (box.bottom - box.top) * 0.36);
      bars.push({ x: box.left, y: (box.top + box.bottom) / 2 - h / 2, w: box.right - box.left, h, color });
    }
  }
  return bars;
}

/** Deterministic pseudo-random number in [0, 1) for a band and a seed. */
function hash(band: number, seed: number): number {
  const s = Math.sin(band * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class PageGlitch implements Drawable {
  readonly z = Z.paneFx;
  private t = 0;
  private resolveDone: () => void = () => {};
  readonly done: Promise<void>;

  constructor(
    private readonly surface: GlitchSurface,
    private readonly bars: Bar[],
    readonly mode: 'out' | 'in',
    private readonly duration: number,
  ) {
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
  }

  /** Adds the glitch to the stage and resolves when it is over. */
  static play(stage: Stage, surface: GlitchSurface, bars: Bar[], mode: 'out' | 'in', duration: number): Promise<void> {
    const glitch = new PageGlitch(surface, bars, mode, settings.duration(duration));
    stage.add(glitch);
    return glitch.done;
  }

  update(dt: number): boolean {
    this.t += dt / this.duration;
    if (this.t >= 1) {
      this.resolveDone();
      return false;
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const u = Math.min(1, this.t);
    // Amount of tearing: grows while glitching out, settles while glitching in.
    const tear = this.mode === 'out' ? u ** 1.4 : (1 - u) ** 1.4;
    const alpha = this.mode === 'out' ? 1 - u * u : Math.min(1, u * 1.6);
    const calm = settings.reduceMotion;
    // Slices are re-randomised a few times per second (once with Reduce motion).
    const seed = calm ? 1 : Math.floor(stage.time * 18);
    const width = this.surface.rect.right - this.surface.rect.left;
    const maxShift = width * 0.22 * tear;
    const split = 2 + 7 * tear;
    const band = 13;

    ctx.save();
    this.surface.enterContent(ctx);
    const shiftOf = (y: number) => {
      const b = Math.floor(y / band);
      const r = hash(b, seed);
      // Only some slices tear; the others barely move.
      return r > 0.55 ? (hash(b, seed + 7) - 0.5) * 2 * maxShift : (r - 0.27) * 6 * tear;
    };
    for (const pass of [RED, CYAN, null]) {
      ctx.globalAlpha = alpha * (pass ? 0.75 : 1);
      for (const bar of this.bars) {
        const dx = shiftOf(bar.y) + (pass === RED ? -split : pass === CYAN ? split : 0);
        ctx.fillStyle = pass ?? bar.color;
        ctx.fillRect(bar.x + dx, bar.y, bar.w, bar.h);
      }
    }
    // A couple of bright scanlines across the page.
    if (!calm && tear > 0.15) {
      const view = this.surface.visibleContent();
      ctx.globalAlpha = 0.7 * tear;
      ctx.fillStyle = CYAN;
      for (let i = 0; i < 2; i++) {
        const y = view.top + hash(i, seed + 3) * (view.bottom - view.top);
        ctx.fillRect(view.left, Math.round(y), view.right - view.left, 1);
      }
    }
    ctx.restore();
  }
}

/** Flickering red and cyan slivers along a pane's edges (the grab step). */
export class EdgeGlitch implements Drawable {
  readonly z = Z.paneFx;
  private t = 0;
  active = true;

  constructor(private readonly rect: () => Box) {}

  update(dt: number): boolean {
    this.t += dt;
    return this.active;
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const r = this.rect();
    const calm = settings.reduceMotion;
    const seed = calm ? 0 : Math.floor(stage.time * 22);
    const strength = Math.min(1, this.t * 4);
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const left = hash(i, seed) > 0.5;
      const y = r.top + 20 + hash(i, seed + 1) * (r.bottom - r.top - 60);
      const len = 14 + hash(i, seed + 2) * 46;
      ctx.globalAlpha = strength * (0.5 + 0.5 * hash(i, seed + 3));
      ctx.fillStyle = hash(i, seed + 4) > 0.5 ? RED : CYAN;
      ctx.fillRect(left ? r.left + 3 : r.right - 5, y, 2, len);
      if (hash(i, seed + 5) > 0.7) ctx.fillRect(left ? r.left + 3 : r.right - 40, y + len / 2, 37, 1);
    }
    ctx.restore();
  }
}
