/** The spider's speech bubble: one short mono line, coming out of its eye. */
import type { Box, Drawable, Point } from '../stage/stage';
import { Z } from '../stage/stage';
import { drawBubble } from './fx';

const LIFE = 2.2;

export class SpeechBubble implements Drawable {
  readonly z = Z.bubbles;
  private line: { text: string; t: number } | null = null;

  constructor(
    private readonly anchor: () => Point | null,
    private readonly bounds: () => Box,
  ) {}

  show(text: string): void {
    this.line = { text, t: 0 };
  }

  /** The line currently shown (tests, accessibility mirror). */
  get text(): string | null {
    return this.line?.text ?? null;
  }

  update(dt: number): void {
    if (!this.line) return;
    this.line.t += dt;
    if (this.line.t > LIFE) this.line = null;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.line) return;
    const at = this.anchor();
    if (!at) return;
    const { t, text } = this.line;
    const alpha = Math.min(1, t / 0.1, (LIFE - t) / 0.3);
    drawBubble(ctx, text, at, alpha, this.bounds());
  }
}
