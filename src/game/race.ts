/**
 * Race bookkeeping, independent from the UI: both racers' paths, hop counts,
 * arrival times and the winner: the first racer on the target.
 */
import { RaceClock } from './clock';

export type Racer = 'player' | 'spider';

export interface PathStep {
  title: string;
  /** Race time (ms) when the racer arrived on this page. */
  at: number;
  /**
   * How the racer got here: a link, the back button, or a swap (the spider
   * snatched the player's link and the panes swapped owners).
   */
  via: 'start' | 'link' | 'back' | 'swap';
  /** Optional annotation (why the spider chose the link, 'snatch'...). */
  note?: string;
}

export interface RacerState {
  path: PathStep[];
  /** Number of page changes since the start article (swaps are free). */
  hops: number;
  /** Race time (ms) when the racer reached the target. */
  arrivedAt: number | null;
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
    return { path: [{ title: start, at: 0, via: 'start' }], hops: 0, arrivedAt: null, retired: false };
  }

  racer(who: Racer): RacerState {
    return who === 'player' ? this.player : this.spider;
  }

  /** True once the racer can no longer move (arrived or retired). */
  isDone(who: Racer): boolean {
    const r = this.racer(who);
    return r.arrivedAt !== null || r.retired;
  }

  /** Records a move. Returns true when this move reaches the target (the first one there wins). */
  move(who: Racer, title: string, via: 'link' | 'back' = 'link', note?: string): boolean {
    const r = this.racer(who);
    if (this.isDone(who)) return false;
    const at = this.clock.elapsed();
    r.path.push({ title, at, via, ...(note ? { note } : {}) });
    r.hops++;
    if (title !== this.targetTitle) return false;
    r.arrivedAt = at;
    this.winner ??= who;
    return true;
  }

  /** Moves a racer without a hop (pane swap). Never finishes the race. */
  teleport(who: Racer, title: string, note?: string): void {
    const r = this.racer(who);
    if (this.isDone(who)) return;
    r.path.push({ title, at: this.clock.elapsed(), via: 'swap', ...(note ? { note } : {}) });
  }

  /** The racer abandons (player gave up, spider stuck). The other can still win by arriving. */
  retire(who: Racer): void {
    const r = this.racer(who);
    if (r.arrivedAt === null) r.retired = true;
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
