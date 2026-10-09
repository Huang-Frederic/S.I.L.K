/**
 * Race bookkeeping, independent from the UI: both racers' paths, hop counts,
 * time penalties, finishing times and the winner.
 *
 * A racer's official finishing time is its arrival time plus its penalties
 * (decoy links cost the player 15 s each). When the player arrives with a
 * penalty the race is not decided yet: it is a photo finish, and the spider
 * still wins if it arrives before the player's official time.
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
  /** Time penalties (ms). */
  penaltyMs: number;
  /** Race time when the racer actually reached the target. */
  arrivedAt: number | null;
  /** Official finishing time: arrival plus penalties. */
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
    return { path: [{ title: start, at: 0, via: 'start' }], hops: 0, penaltyMs: 0, arrivedAt: null, finishedAt: null, retired: false };
  }

  racer(who: Racer): RacerState {
    return who === 'player' ? this.player : this.spider;
  }

  other(who: Racer): Racer {
    return who === 'player' ? 'spider' : 'player';
  }

  /** True once the racer can no longer move (arrived or retired). */
  isDone(who: Racer): boolean {
    const r = this.racer(who);
    return r.arrivedAt !== null || r.retired;
  }

  /**
   * Records a move. Returns true when this move reaches the target. The
   * winner is decided by official times (see `settle`).
   */
  move(who: Racer, title: string, via: 'link' | 'back' = 'link', note?: string): boolean {
    const r = this.racer(who);
    if (this.isDone(who)) return false;
    const at = this.clock.elapsed();
    r.path.push({ title, at, via, ...(note ? { note } : {}) });
    r.hops++;
    if (title !== this.targetTitle) return false;
    r.arrivedAt = at;
    r.finishedAt = at + r.penaltyMs;
    this.settle();
    return true;
  }

  /** Moves a racer without a hop (pane swap). Never finishes the race. */
  teleport(who: Racer, title: string, note?: string): void {
    const r = this.racer(who);
    if (this.isDone(who)) return;
    r.path.push({ title, at: this.clock.elapsed(), via: 'swap', ...(note ? { note } : {}) });
  }

  /** Adds a time penalty (ignored once the racer has arrived). */
  penalize(who: Racer, ms: number): void {
    const r = this.racer(who);
    if (!this.isDone(who)) r.penaltyMs += ms;
  }

  /** The racer abandons (player gave up, spider stuck). The other can still win by arriving. */
  retire(who: Racer): void {
    const r = this.racer(who);
    if (r.arrivedAt === null) r.retired = true;
    this.settle();
  }

  /**
   * Decides the winner once it is certain: the racer with the earliest
   * official time wins when that time has passed, or as soon as the other
   * racer can no longer beat it. Call it regularly while a photo finish runs.
   */
  settle(): Racer | null {
    if (this.winner) return this.winner;
    const now = this.clock.elapsed();
    const finished = (['player', 'spider'] as const).filter((who) => this.racer(who).finishedAt !== null);
    if (!finished.length) return null;
    finished.sort((a, b) => this.racer(a).finishedAt! - this.racer(b).finishedAt!);
    const best = finished[0];
    const other = this.racer(this.other(best));
    const time = this.racer(best).finishedAt!;
    // The other racer can still beat a pending official time by arriving first.
    const canStillBeat = other.arrivedAt === null && !other.retired && time > now;
    if (!canStillBeat) this.winner = best;
    return this.winner;
  }

  /** A racer arrived but its penalties keep the race open until `until`. */
  get photoFinish(): { who: Racer; until: number } | null {
    if (this.winner) return null;
    for (const who of ['player', 'spider'] as const) {
      const r = this.racer(who);
      if (r.finishedAt !== null && r.finishedAt > this.clock.elapsed()) return { who, until: r.finishedAt };
    }
    return null;
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
