/**
 * Race bookkeeping, independent from the UI: both racers' paths, hop counts,
 * finishing times and the winner.
 */
import { RaceClock } from './clock';

export type Racer = 'player' | 'spider';

export interface PathStep {
  title: string;
  /** Race time (ms) when the racer arrived on this page. */
  at: number;
  /** How the racer got here. */
  via: 'start' | 'link' | 'back';
  /** Optional annotation (the spider records why it chose the link). */
  note?: string;
}

export interface RacerState {
  path: PathStep[];
  /** Number of page changes since the start article. */
  hops: number;
  /** Race time when the target was reached. */
  finishedAt: number | null;
  /** True when the racer abandoned (player gave up, spider got stuck). */
  retired: boolean;
}

export class Race {
  readonly clock: RaceClock;
  readonly player: RacerState;
  readonly spider: RacerState;
  winner: Racer | null = null;

  constructor(
    readonly startTitle: string,
    readonly targetTitle: string,
    clock: RaceClock = new RaceClock(),
  ) {
    this.clock = clock;
    this.player = Race.newRacer(startTitle);
    this.spider = Race.newRacer(startTitle);
  }

  private static newRacer(start: string): RacerState {
    return { path: [{ title: start, at: 0, via: 'start' }], hops: 0, finishedAt: null, retired: false };
  }

  racer(who: Racer): RacerState {
    return who === 'player' ? this.player : this.spider;
  }

  /** True once the racer can no longer move (finished or retired). */
  isDone(who: Racer): boolean {
    const r = this.racer(who);
    return r.finishedAt !== null || r.retired;
  }

  /**
   * Records a move. Returns true when this move reaches the target; the first
   * racer to do so becomes the winner.
   */
  move(who: Racer, title: string, via: 'link' | 'back' = 'link', note?: string): boolean {
    const r = this.racer(who);
    if (this.isDone(who)) return false;
    const at = this.clock.elapsed();
    r.path.push({ title, at, via, ...(note ? { note } : {}) });
    r.hops++;
    if (title !== this.targetTitle) return false;
    r.finishedAt = at;
    if (!this.winner) this.winner = who;
    return true;
  }

  /** The racer abandons (player gave up, spider stuck). The other can still win by arriving. */
  retire(who: Racer): void {
    const r = this.racer(who);
    if (r.finishedAt === null) r.retired = true;
  }

  /** True when nobody can move any more. */
  get over(): boolean {
    return this.isDone('player') && this.isDone('spider');
  }

  current(who: Racer): string {
    const path = this.racer(who).path;
    return path[path.length - 1].title;
  }
}
