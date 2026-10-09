/** A pausable stopwatch (the race pauses while the browser tab is hidden). */
export class RaceClock {
  private startedAt: number | null = null;
  private accumulated = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  get running(): boolean {
    return this.startedAt !== null;
  }

  start(): void {
    if (this.startedAt === null) this.startedAt = this.now();
  }

  pause(): void {
    if (this.startedAt === null) return;
    this.accumulated += this.now() - this.startedAt;
    this.startedAt = null;
  }

  /** Milliseconds of race time elapsed so far. */
  elapsed(): number {
    return this.accumulated + (this.startedAt === null ? 0 : this.now() - this.startedAt);
  }
}
