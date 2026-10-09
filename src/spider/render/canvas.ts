/**
 * Full-resolution overlay canvas above an article pane.
 *
 * Drawing happens in the article's content coordinates (CSS px): the canvas
 * transform folds in the device pixel ratio and the current scroll offset, so
 * effects stay glued to the text while the camera scrolls and thin lines stay
 * sharp on HiDPI screens.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class OverlayCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Visible size in CSS px. */
  width = 0;
  height = 0;
  dpr = 1;
  private readonly observer: ResizeObserver | null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly host: HTMLElement,
    private readonly scroller: HTMLElement,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-layer';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(host);
    this.resize();
  }

  /** Called after the pane changed size (and the article's layout with it). */
  onResize(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    for (const listener of this.listeners) listener();
  }

  /** Clears the canvas and returns a context drawing in content coordinates. */
  begin(): CanvasRenderingContext2D {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, -this.scroller.scrollLeft * dpr, -this.scroller.scrollTop * dpr);
    return ctx;
  }

  /** The visible part of the content. */
  get view(): Box {
    const left = this.scroller.scrollLeft;
    const top = this.scroller.scrollTop;
    return { left, top, right: left + this.width, bottom: top + this.height };
  }

  /** Box of an element in content coordinates (independent of the scroll). */
  contentBox(el: Element): Box {
    return this.toContent(el.getBoundingClientRect());
  }

  /** Converts a viewport rect (e.g. from getClientRects) to content coordinates. */
  toContent(rect: DOMRect | DOMRectReadOnly): Box {
    const base = this.scroller.getBoundingClientRect();
    const dx = this.scroller.scrollLeft - base.left;
    const dy = this.scroller.scrollTop - base.top;
    return { left: rect.left + dx, top: rect.top + dy, right: rect.right + dx, bottom: rect.bottom + dy };
  }

  destroy(): void {
    this.observer?.disconnect();
    this.listeners.clear();
    this.canvas.remove();
  }
}

export function boxCenter(box: Box): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/** Distance from a point to a box (0 inside). */
export function distanceToBox(p: Point, box: Box): number {
  const dx = Math.max(box.left - p.x, 0, p.x - box.right);
  const dy = Math.max(box.top - p.y, 0, p.y - box.bottom);
  return Math.hypot(dx, dy);
}
