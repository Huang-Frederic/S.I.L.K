/**
 * The stage: one full-window overlay canvas above the whole race screen, so
 * the spider and its attacks can move freely across both panes, the HUD and
 * the gutter between them.
 *
 * It also runs the frame loop. Animations are written as coroutines that
 * `await stage.frame()`; the loop resolves those promises once per frame with
 * the frame's delta time (or never, while paused), which keeps every
 * animation readable and pausable.
 */
import { settings } from '../settings';

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

export interface Drawable {
  /** Paint order: lower first. */
  z: number;
  draw(ctx: CanvasRenderingContext2D, stage: Stage): void;
  /** Advances the effect; returning false removes it. */
  update?(dt: number, stage: Stage): boolean | void;
}

/** Common paint layers. */
export const Z = {
  paneFx: 10,
  links: 20,
  traps: 30,
  silk: 40,
  minions: 50,
  spider: 60,
  projectiles: 70,
  blackout: 80,
  bubbles: 90,
  cursor: 100,
} as const;

/** Thrown into pending animations when the stage is destroyed. */
export class StageClosedError extends Error {
  constructor() {
    super('Stage closed');
    this.name = 'StageClosedError';
  }
}

export interface PointerState {
  /** Position in stage coordinates. */
  x: number;
  y: number;
  /** True while a mouse/pen pointer is over the stage. */
  inside: boolean;
  /** 'mouse', 'pen' or 'touch'. */
  type: string;
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Size in CSS px and device pixel ratio. */
  width = 0;
  height = 0;
  dpr = 1;
  /** Seconds of (unpaused) stage time. */
  time = 0;
  frameCount = 0;
  readonly pointer: PointerState = { x: -1e4, y: -1e4, inside: false, type: 'mouse' };
  /** Client rect of the root, refreshed every frame. */
  rootRect: DOMRect = new DOMRect();

  private readonly drawables = new Set<Drawable>();
  private readonly beforeFrame = new Set<() => void>();
  private waiters: Array<{ resolve: (dt: number) => void; reject: (error: Error) => void }> = [];
  private paused = false;
  private drawnWhilePaused = false;
  private closed = false;
  private rafId = 0;
  private lastTime = 0;
  private shakeEnergy = 0;
  private shakeOffset: Point = { x: 0, y: 0 };
  private readonly observer: ResizeObserver | null;
  private readonly onPointerMove = (event: PointerEvent) => this.trackPointer(event, true);
  private readonly onPointerLeave = () => (this.pointer.inside = false);

  constructor(readonly root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(root);
    root.addEventListener('pointermove', this.onPointerMove, { passive: true });
    root.addEventListener('pointerdown', this.onPointerMove, { passive: true });
    root.addEventListener('pointerleave', this.onPointerLeave);
    this.resize();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ----------------------------------------------------------- registry

  add(drawable: Drawable): () => void {
    this.drawables.add(drawable);
    return () => this.drawables.delete(drawable);
  }

  remove(drawable: Drawable): void {
    this.drawables.delete(drawable);
  }

  /** Runs `fn` at the start of every frame (e.g. to measure panes). */
  onFrame(fn: () => void): () => void {
    this.beforeFrame.add(fn);
    return () => this.beforeFrame.delete(fn);
  }

  // ---------------------------------------------------------- coroutines

  /** Resolves on the next (unpaused) frame with its delta time in seconds. */
  frame(): Promise<number> {
    if (this.closed) return Promise.reject(new StageClosedError());
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async wait(seconds: number): Promise<void> {
    let elapsed = 0;
    while (elapsed < seconds) elapsed += await this.frame();
  }

  /** Calls `step(t)` with t going 0 -> 1 over `seconds`. */
  async tween(seconds: number, step: (t: number) => void): Promise<void> {
    let elapsed = 0;
    step(0);
    while (elapsed < seconds) {
      elapsed += await this.frame();
      step(Math.min(1, elapsed / Math.max(1e-6, seconds)));
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * A short screen shake (ignored when Reduce motion is on). The offset is
   * published as --shake-x / --shake-y on the root, which CSS applies to the
   * whole screen so that the text and the canvas move together.
   */
  shake(strength: number): void {
    if (settings.reduceMotion) return;
    this.shakeEnergy = Math.min(14, this.shakeEnergy + strength);
  }

  destroy(): void {
    this.closed = true;
    cancelAnimationFrame(this.rafId);
    this.observer?.disconnect();
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerdown', this.onPointerMove);
    this.root.removeEventListener('pointerleave', this.onPointerLeave);
    for (const waiter of this.waiters) waiter.reject(new StageClosedError());
    this.waiters = [];
    this.drawables.clear();
    this.canvas.remove();
  }

  // ------------------------------------------------------------- internals

  /** Converts client coordinates to stage coordinates. */
  fromClient(x: number, y: number): Point {
    return { x: x - this.rootRect.left, y: y - this.rootRect.top };
  }

  private trackPointer(event: PointerEvent, inside: boolean): void {
    const rect = this.root.getBoundingClientRect();
    this.pointer.x = event.clientX - rect.left;
    this.pointer.y = event.clientY - rect.top;
    this.pointer.inside = inside;
    this.pointer.type = event.pointerType || 'mouse';
  }

  private resize(): void {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.drawnWhilePaused = false;
  }

  private loop = (now: number): void => {
    if (this.closed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    this.rootRect = this.root.getBoundingClientRect();
    for (const fn of this.beforeFrame) fn();

    if (this.paused) {
      if (!this.drawnWhilePaused) this.render();
      this.drawnWhilePaused = true;
      return;
    }
    this.drawnWhilePaused = false;
    // Draw what the coroutines prepared last frame, then let them step again.
    this.render();
    this.time += dt;
    this.frameCount++;
    this.updateShake(dt);
    for (const drawable of [...this.drawables]) {
      if (drawable.update && drawable.update(dt, this) === false) this.drawables.delete(drawable);
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve(dt);
  };

  private updateShake(dt: number): void {
    this.shakeEnergy = Math.max(0, this.shakeEnergy - dt * 40);
    const e = this.shakeEnergy;
    const next = e > 0.1 ? { x: (Math.random() - 0.5) * e, y: (Math.random() - 0.5) * e } : { x: 0, y: 0 };
    // Only touch the style when something changes (it triggers a style recalc).
    if (next.x === this.shakeOffset.x && next.y === this.shakeOffset.y) return;
    this.shakeOffset = next;
    this.root.style.setProperty('--shake-x', `${next.x.toFixed(1)}px`);
    this.root.style.setProperty('--shake-y', `${next.y.toFixed(1)}px`);
  }

  private render(): void {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // No shake offset here: the root itself is shaken (CSS translate), canvas included.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ordered = [...this.drawables].sort((a, b) => a.z - b.z);
    for (const drawable of ordered) {
      ctx.save();
      drawable.draw(ctx, this);
      ctx.restore();
    }
  }
}
