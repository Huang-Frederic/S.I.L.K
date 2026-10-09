/**
 * The spider rig: procedural, line-drawn, legs placed by inverse kinematics
 * on the real text.
 *
 *  - Body: a plain outlined rectangle that stays upright: it never spins
 *    round. Its one red eye slides round the inside of the body to face where
 *    the spider goes or looks, and the body sways a little with its stride.
 *  - Legs: 1.5 px strokes, 2 px knee dots, 3 px foot rings; reach ~3 lines.
 *    Each leg owns a sector around the body and its hip, knee and foot always
 *    stay inside it, so legs never cross. The knees stick out towards the
 *    sides of the body.
 *  - Feet only ever stand on words (each planted foot boxes its word in
 *    cyan). A leg with no word within reach is held up off the page instead
 *    of gripping thin air.
 *  - Gait: an alternating tetrapod (L1 R2 L3 R4 / R1 L2 R3 L4) paced by the
 *    distance walked: one group swings while the other stands, each foot
 *    landing far enough ahead that it stays balanced around its resting spot,
 *    swinging up and out on its way. A foot left too far behind, or whose
 *    word is destroyed under it, steps at once. Standing still, the feet
 *    settle back to their resting spots.
 *  - Poses: stand (walk / idle breathing), hang, grab (legs wrap a link),
 *    dance, collapse; plus a wiggle and a carried word for throws.
 *
 * Coordinates are those of the surface the spider stands on (a pane's
 * content coordinates), or stage coordinates while it is airborne: the
 * caller sets up the canvas transform accordingly.
 */
import type { Box, Point } from '../stage/stage';
import type { Word } from '../stage/wordIndex';

export interface Foothold {
  point: Point;
  word: Word | null;
}

/**
 * Decides where a foot lands, among the points `accept` allows. Null means
 * there is nothing to stand on there.
 */
export interface Ground {
  hold(desired: Point, accept?: (point: Point) => boolean): Foothold | null;
}

/** Open space (the stage, a mini-spider's run): feet land where they aim. */
export const OPEN_GROUND: Ground = { hold: (point) => ({ point, word: null }) };

export type Pose = 'stand' | 'hang' | 'grab' | 'dance' | 'collapse';

export const COLORS = {
  line: '#F0F4F8',
  page: '#101418',
  footBox: '#4FD8E8',
  eye: '#FF2B3A',
  eyeGlow: 'rgba(255, 43, 58, 0.9)',
  player: '#FFB547',
};

/** One leg as drawn. */
export interface LegShape {
  hip: Point;
  knee: Point;
  foot: Point;
  /** The foot stands on the page (on `word`, or anywhere on open ground). */
  planted: boolean;
  word: Word | null;
}

interface Leg {
  side: 1 | -1;
  index: number;
  group: 0 | 1;
  /** Body space. */
  hip: Point;
  /** Direction of the resting foot from the hip (radians, screen space). */
  angle: number;
  foot: Point;
  from: Point;
  to: Point;
  /** Swing progress (1 = down). */
  t: number;
  duration: number;
  /** How far the foot swings out mid-step (px). */
  arc: number;
  word: Word | null;
  /** Nothing to stand on within reach: the leg is held up off the page. */
  lifted: boolean;
  /** When a held-up leg looks for a foothold again (rig time). */
  retryAt: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

const HALF_W = 12;
const HALF_H = 22;
const FEMUR = 52;
const TIBIA = 56;
const REACH = FEMUR + TIBIA;
/** Hip-to-foot distance of a resting foot, and of a held-up one. */
const REST = REACH * 0.64;
const HOVER = REACH * 0.45;
const HIP_Y = [-15, -5, 5, 15];
/** Resting directions of the right legs (body space, y down): each foot rests mid-sector. The left legs mirror them. */
const ANGLES = [-73, -24, 24, 73].map(deg);
/**
 * Each right leg's sector around the body centre (the left legs mirror
 * them). Sectors do not overlap, and a leg's hip, knee and foot all stay
 * inside its own: legs cannot cross.
 */
const SECTORS: Array<[number, number]> = [
  [-87, -50],
  [-44, -3],
  [3, 44],
  [50, 87],
].map(([a, b]) => [deg(a), deg(b)]);
/**
 * Footholds are picked this far inside the sector, and a planted foot may
 * drift this far out of it (into the gap between two sectors) before it has
 * to step: a foot does not have to move again as soon as it lands.
 */
const MARGIN = deg(6);
const SLACK = deg(2.5);
/** A foot lands between these fractions of the reach from its hip... */
const NEAREST = 0.3;
const FARTHEST = 0.92;
/** ...and steps again at once past this stretch. */
const OVERSTRETCH = 0.98;
/** How long the swing of a step lasts (s). */
const SWING_MIN = 0.06;
const SWING_MAX = 0.2;
/** How fast the eye slides round to a new heading (rad/s). */
const EYE_TURN_RATE = 12;
/** The eye's track inside the body: an ellipse (body space). */
const EYE_RX = 5.5;
const EYE_RY = 12;
/** Seen from above, a knee sticks out sideways by this share of its bend. */
const KNEE_OUT = 0.5;

const ZERO: Point = { x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Angle wrapped to [-pi, pi]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class SpiderRig {
  x = 0;
  y = 0;
  size = 1;
  scale = 1;
  /** Body rotation (0: upright). The body never turns to walk: only a collapse tips it over. */
  tilt = 0;
  /** Where the eye faces (radians, 0 = up, clockwise), and where it is sliding to. */
  heading = 0;
  targetHeading = 0;
  fold = 0;
  pose: Pose = 'stand';
  grounded = false;
  eyeOpen = 1;
  rage = false;
  /** Where the eye looks (pupil shift), in the rig's coordinates. */
  lookAt: Point | null = null;
  /** Word held up by the front leg before a throw. */
  carried: { text: string; side: 1 | -1 } | null = null;
  /** Link wrapped by the legs (grab pose). */
  grabBox: Box | null = null;
  visible = true;
  /** Seconds, drives breathing, dancing and blinking. */
  time = 0;
  /**
   * Called when a foot lands on a word; returns true when it crushed the
   * word (the foot then holds nothing).
   */
  onPlant: ((word: Word) => boolean) | null = null;

  private readonly legs: Leg[] = [];
  private lastX = 0;
  private lastY = 0;
  private vx = 0;
  private vy = 0;
  private wiggleUntil = 0;
  /** Which leg group swings next. */
  private turn = 0;
  /** Distance walked since a group last swung. */
  private travel = 0;
  /** Walking (rather than standing) at the last update. */
  private moving = false;
  /** Walk cycle, in half strides: drives the sway. */
  private phase = 0;
  private sway: Point = { x: 0, y: 0 };

  constructor(size = 1) {
    this.size = size;
    for (const side of [1, -1] as const) {
      for (let i = 0; i < 4; i++) {
        this.legs.push({
          side,
          index: i,
          group: (side === 1 ? i % 2 : (i + 1) % 2) as 0 | 1,
          hip: { x: HALF_W * side, y: HIP_Y[i] },
          angle: side === 1 ? ANGLES[i] : Math.PI - ANGLES[i],
          foot: { x: 0, y: 0 },
          from: { x: 0, y: 0 },
          to: { x: 0, y: 0 },
          t: 1,
          duration: 0.1,
          arc: 0,
          word: null,
          lifted: false,
          retryAt: 0,
        });
      }
    }
  }

  /** Full leg reach in the rig's coordinates. */
  get reach(): number {
    return REACH * this.size * this.scale;
  }

  /** The eye dot (where lasers come from). */
  eye(): Point {
    return this.toWorld(this.eyeSpot());
  }

  /** Where the silk comes out: the edge of the body opposite the eye. */
  spinneret(): Point {
    return this.toWorld({ x: -Math.sin(this.heading) * HALF_W, y: Math.cos(this.heading) * HALF_H });
  }

  /** Top of the body: a hanging thread attaches here. */
  top(): Point {
    return this.toWorld({ x: 0, y: -HALF_H });
  }

  /** Where the front leg holds a carried word up (before a throw). */
  carryPoint(side: 1 | -1): Point {
    const p = this.toWorld({ x: 26 * side, y: -62 });
    return { x: p.x, y: p.y - 12 * this.size * this.scale };
  }

  /** Stretch of the most stretched planted leg, as a fraction of the reach. */
  maxStretch(): number {
    let max = 0;
    for (const leg of this.legGeometry()) {
      if (leg.planted) max = Math.max(max, Math.hypot(leg.foot.x - leg.hip.x, leg.foot.y - leg.hip.y) / this.reach);
    }
    return max;
  }

  /** Turns the eye towards a direction (the body stays upright). */
  face(direction: Point): void {
    if (Math.hypot(direction.x, direction.y) < 1e-6) return;
    this.targetHeading = Math.atan2(direction.x, -direction.y);
  }

  /** True once the eye has slid round to its heading. */
  get facing(): boolean {
    return Math.abs(wrap(this.targetHeading - this.heading)) < 0.06;
  }

  /** Feet as drawn. */
  feet(): Point[] {
    return this.legGeometry().map((leg) => leg.foot);
  }

  /** Words currently under a planted foot. */
  heldWords(): Word[] {
    return this.legs.filter((l) => l.t >= 1 && !l.lifted && l.word && !l.word.gone).map((l) => l.word!);
  }

  /** A quick celebratory shake (snatches, wins). */
  wiggle(seconds = 0.45): void {
    this.wiggleUntil = this.time + seconds;
  }

  get isWiggling(): boolean {
    return this.time < this.wiggleUntil;
  }

  /** Puts every foot down at once around the body (after landing). */
  plantAll(ground: Ground): void {
    this.grounded = true;
    this.travel = 0;
    this.lastX = this.x;
    this.lastY = this.y;
    this.vx = this.vy = 0;
    this.moving = false;
    for (const leg of this.legs) {
      const hold = this.footholdFor(leg, this.restFoot(leg), ground, ZERO);
      leg.word = hold?.word ?? null;
      leg.lifted = !hold;
      leg.foot = leg.from = leg.to = hold ? hold.point : this.hoverFoot(leg);
      leg.retryAt = this.time;
      leg.t = 1;
    }
  }

  /** Lifts every foot: legs then follow the body (hanging, flying, diving). */
  liftAll(): void {
    this.grounded = false;
    for (const leg of this.legs) {
      leg.word = null;
      leg.lifted = false;
      leg.foot = leg.from = leg.to = this.restFoot(leg);
      leg.t = 1;
    }
  }

  update(dt: number, ground: Ground = OPEN_GROUND): void {
    this.time += dt;
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    if (dt > 0) {
      const k = Math.min(1, dt * 10);
      this.vx += ((this.x - this.lastX) / dt - this.vx) * k;
      this.vy += ((this.y - this.lastY) / dt - this.vy) * k;
    }
    this.lastX = this.x;
    this.lastY = this.y;

    // The eye slides round to its new heading, the short way.
    const turn = wrap(this.targetHeading - this.heading);
    const rate = EYE_TURN_RATE * dt;
    this.heading = wrap(this.heading + clamp(turn, -rate, rate));

    // The body sways across the way it walks, in step with the legs.
    const speed = Math.hypot(this.vx, this.vy);
    const walking = this.grounded && this.pose === 'stand';
    const stride = this.strideLength(speed);
    if (walking) this.phase += moved / (stride / 2);
    const swayBy = walking ? Math.sin(this.phase * Math.PI) * 1.8 * this.size * Math.min(1, speed / 90) : 0;
    this.sway = speed > 1 ? { x: (-this.vy / speed) * swayBy, y: (this.vx / speed) * swayBy } : { x: 0, y: 0 };

    if (this.pose === 'grab' && this.grabBox) {
      this.placeAround(this.grabBox, dt);
      return;
    }
    if (this.pose === 'collapse') {
      this.curl(dt);
      return;
    }
    if (!this.grounded || this.pose === 'hang') {
      this.dangle();
      return;
    }

    // Swings under way; held-up feet hover by their hips.
    for (const leg of this.legs) {
      if (leg.t < 1) this.swing(leg, dt);
      else if (leg.lifted) leg.foot = this.hoverFoot(leg);
    }
    if (this.pose === 'dance') return;

    const dir = speed > 4 ? { x: this.vx / speed, y: this.vy / speed } : null;
    // A swing takes most of a half stride: both groups stand together for a moment.
    const swingTime = clamp((0.9 * stride) / 2 / Math.max(speed, 1), SWING_MIN, SWING_MAX);
    // A foot left too far behind, outside its sector or on a destroyed word
    // steps at once; a held-up leg looks for a foothold again now and then.
    for (const leg of this.legs) {
      if (leg.t < 1) continue;
      if (leg.lifted ? this.time >= leg.retryAt : this.mustStep(leg)) this.step(leg, ground, dir, speed, stride, swingTime);
    }

    if (walking && dir) {
      // The rhythm: every half stride walked, the next group swings, once
      // the other group is nearly down. Setting off, the first group swings
      // at once.
      if (!this.moving) this.travel = stride / 2;
      this.moving = true;
      this.travel += moved;
      const busy = this.legs.some((l) => l.group !== this.turn && l.t < 0.7);
      if (this.travel >= stride / 2 && !busy) {
        for (const leg of this.legs) if (leg.group === this.turn && leg.t >= 1) this.step(leg, ground, dir, speed, stride, swingTime);
        this.turn = 1 - this.turn;
        this.travel = Math.min(this.travel - stride / 2, stride / 2);
      }
    } else if (speed < 6 && this.legs.every((l) => l.t >= 1)) {
      // Standing still: the feet settle back to their resting spots, one group at a time.
      this.travel = 0;
      this.moving = false;
      const astray = (group: number) => this.legs.filter((l) => l.group === group && !l.lifted && this.offRest(l) > 0.22 * this.reach);
      let group = astray(this.turn);
      if (!group.length) {
        group = astray(1 - this.turn);
        if (group.length) this.turn = 1 - this.turn;
      }
      if (group.length) {
        for (const leg of group) this.step(leg, ground, null, 0, stride, 0.16);
        this.turn = 1 - this.turn;
      }
    }
  }

  /** Distance the body covers in one full walk cycle (each group swings once). */
  private strideLength(speed: number): number {
    return clamp(36 + 0.12 * speed, 36, REACH * 0.62) * this.size * this.scale;
  }

  /**
   * Swings a leg to a new foothold: when walking, far enough ahead of its
   * resting spot that it ends up as far behind it when it lifts again;
   * standing, right on it. With nothing to stand on, the leg comes up.
   */
  private step(leg: Leg, ground: Ground, dir: Point | null, speed: number, stride: number, duration: number): void {
    // Where the body will be when the foot comes down, and when it lifts again.
    const travel = dir ? speed * duration : 0;
    const shift = dir ? { x: dir.x * travel, y: dir.y * travel } : ZERO;
    const stance = dir ? Math.max(0, stride - travel) : 0;
    const end = dir ? { x: shift.x + dir.x * stance, y: shift.y + dir.y * stance } : ZERO;
    const rest = this.restFoot(leg);
    const desired = { x: rest.x + shift.x + (dir ? (dir.x * stance) / 2 : 0), y: rest.y + shift.y + (dir ? (dir.y * stance) / 2 : 0) };
    // Best a foothold the foot can keep for its whole stance, otherwise one it can land on.
    const lasts = (p: Point) => this.inSector(leg, p, -SLACK, end) && this.stretchAt(leg, p, end) <= OVERSTRETCH - 0.02;
    const hold = (dir && this.footholdFor(leg, desired, ground, shift, lasts)) || this.footholdFor(leg, desired, ground, shift);
    if (!hold) {
      this.holdUp(leg);
      return;
    }
    leg.from = { ...leg.foot };
    leg.to = hold.point;
    leg.word = hold.word;
    leg.lifted = false;
    // No two steps quite alike.
    leg.duration = duration * (0.9 + Math.random() * 0.2);
    leg.arc = (4 + Math.random() * 5) * this.size;
    leg.t = 0;
  }

  /** Nothing to stand on: the leg comes up off the page, and looks again a little later. */
  private holdUp(leg: Leg): void {
    leg.retryAt = this.time + 0.08 + Math.random() * 0.06;
    leg.word = null;
    if (leg.lifted) return;
    leg.lifted = true;
    leg.from = { ...leg.foot };
    leg.duration = 0.14;
    leg.arc = 3 * this.size;
    leg.t = 0;
  }

  /** Moves a swinging foot along its arc: up and out, away from the body. */
  private swing(leg: Leg, dt: number): void {
    leg.t = Math.min(1, leg.t + dt / leg.duration);
    const e = leg.t * leg.t * (3 - 2 * leg.t);
    const to = leg.lifted ? this.hoverFoot(leg) : leg.to;
    const p = { x: leg.from.x + (to.x - leg.from.x) * e, y: leg.from.y + (to.y - leg.from.y) * e };
    const c = this.center();
    const out = { x: p.x - c.x, y: p.y - c.y };
    const len = Math.hypot(out.x, out.y) || 1;
    const lift = Math.sin(leg.t * Math.PI) * leg.arc;
    leg.foot = { x: p.x + (out.x / len) * lift, y: p.y + (out.y / len) * lift };
    if (leg.t < 1) return;
    leg.foot = { ...to };
    if (!leg.lifted && leg.word && this.onPlant?.(leg.word)) leg.word = null;
  }

  /** A planted foot that cannot stay where it is. */
  private mustStep(leg: Leg): boolean {
    if (leg.word?.gone) return true;
    const hip = this.toWorld(leg.hip);
    const stretch = Math.hypot(leg.foot.x - hip.x, leg.foot.y - hip.y) / this.reach;
    return stretch > OVERSTRETCH || stretch < NEAREST * 0.75 || !this.inSector(leg, leg.foot, -SLACK, ZERO);
  }

  private offRest(leg: Leg): number {
    const rest = this.restFoot(leg);
    return Math.hypot(leg.foot.x - rest.x, leg.foot.y - rest.y);
  }

  /**
   * A foothold near `desired` that the leg can use once the body has moved
   * by `shift`: inside its sector (with a margin) and within its reach.
   */
  private footholdFor(leg: Leg, desired: Point, ground: Ground, shift: Point, also?: (p: Point) => boolean): Foothold | null {
    const fits = (p: Point) => this.fits(leg, p, shift) && (!also || also(p));
    const hold = ground.hold(this.bringInto(leg, desired, shift), fits);
    if (!hold) return null;
    // Open ground has no words to check: the foot lands where it aims.
    return hold.word && !fits(hold.point) ? null : hold;
  }

  private fits(leg: Leg, p: Point, shift: Point): boolean {
    const d = this.stretchAt(leg, p, shift);
    return d >= NEAREST && d <= FARTHEST && this.inSector(leg, p, MARGIN, shift);
  }

  /** How stretched the leg would be with its foot on `p`, the body moved by `shift`. */
  private stretchAt(leg: Leg, p: Point, shift: Point): number {
    const hip = this.toWorld(leg.hip);
    return Math.hypot(p.x - hip.x - shift.x, p.y - hip.y - shift.y) / this.reach;
  }

  // ------------------------------------------------------------------ poses

  /** Legs dangle under a hanging or flying body. */
  private dangle(): void {
    this.legs.forEach((leg, i) => {
      const rest = this.restFoot(leg);
      const w = 2.2 * this.size * Math.sin(this.time * 2.6 + i * 1.7);
      leg.foot = { x: rest.x + w, y: rest.y - w * 0.4 };
      leg.t = 1;
      leg.word = null;
      leg.lifted = false;
    });
  }

  /** Feet on the outline of a link: the legs wrap around it. */
  private placeAround(box: Box, dt: number): void {
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const cy = (box.top + box.bottom) / 2;
    const k = Math.min(1, dt * 14);
    for (const leg of this.legs) {
      const edgeX = leg.side === 1 ? box.right : box.left;
      const inward = -leg.side;
      const targets = [
        { x: edgeX + inward * w * 0.18, y: box.top - 4 },
        { x: edgeX + leg.side * 5, y: cy - h * 0.3 },
        { x: edgeX + leg.side * 5, y: cy + h * 0.3 },
        { x: edgeX + inward * w * 0.18, y: box.bottom + 4 },
      ];
      const target = targets[leg.index];
      leg.foot = { x: leg.foot.x + (target.x - leg.foot.x) * k, y: leg.foot.y + (target.y - leg.foot.y) * k };
      leg.t = 1;
      leg.word = null;
      leg.lifted = false;
    }
  }

  /** Legs curled under the body (defeat). */
  private curl(dt: number): void {
    const k = Math.min(1, dt * 3);
    for (const leg of this.legs) {
      const target = this.toWorld({ x: leg.hip.x + leg.side * 10, y: leg.hip.y + 14 });
      leg.foot = { x: leg.foot.x + (target.x - leg.foot.x) * k, y: leg.foot.y + (target.y - leg.foot.y) * k };
      leg.word = null;
      leg.lifted = false;
    }
  }

  // --------------------------------------------------------------- geometry

  /** Body centre as drawn (with the sway). */
  private center(): Point {
    return { x: this.x + this.sway.x, y: this.y + this.sway.y };
  }

  private eyeSpot(): Point {
    return { x: Math.sin(this.heading) * EYE_RX, y: -Math.cos(this.heading) * EYE_RY };
  }

  /** Where a foot rests (it folds in while hanging). */
  private restFoot(leg: Leg, radius = REST): Point {
    const hip = this.toWorld(leg.hip);
    const r = radius * this.size * this.scale * (1 - 0.62 * this.fold);
    const a = leg.angle + this.tilt;
    return { x: hip.x + Math.cos(a) * r, y: hip.y + Math.sin(a) * r };
  }

  /** Where a held-up foot hovers. */
  private hoverFoot(leg: Leg): Point {
    return this.restFoot(leg, HOVER);
  }

  private toWorld(local: Point): Point {
    const k = this.size * this.scale;
    const c = Math.cos(this.tilt);
    const s = Math.sin(this.tilt);
    const o = this.center();
    return { x: o.x + (local.x * c - local.y * s) * k, y: o.y + (local.x * s + local.y * c) * k };
  }

  /** A point relative to `origin`, unrotated, with the left side mirrored onto the right. */
  private bodySpace(leg: Leg, p: Point, origin: Point): Point {
    const c = Math.cos(-this.tilt);
    const s = Math.sin(-this.tilt);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: (dx * c - dy * s) * leg.side, y: dx * s + dy * c };
  }

  private fromBodySpace(leg: Leg, local: Point, origin: Point): Point {
    const c = Math.cos(this.tilt);
    const s = Math.sin(this.tilt);
    const lx = local.x * leg.side;
    return { x: origin.x + lx * c - local.y * s, y: origin.y + lx * s + local.y * c };
  }

  /** True when `p` lies inside the leg's sector (narrowed by `margin`), the body moved by `shift`. */
  private inSector(leg: Leg, p: Point, margin: number, shift: Point): boolean {
    const o = this.center();
    const local = this.bodySpace(leg, p, { x: o.x + shift.x, y: o.y + shift.y });
    const a = Math.atan2(local.y, local.x);
    const [lo, hi] = SECTORS[leg.index];
    return a >= lo + margin && a <= hi - margin;
  }

  /** Turns a point round the body centre into the leg's sector (narrowed by `margin`), keeping its distance. */
  private toSector(leg: Leg, p: Point, margin: number, shift: Point): Point {
    const o = this.center();
    const origin = { x: o.x + shift.x, y: o.y + shift.y };
    const local = this.bodySpace(leg, p, origin);
    const [lo, hi] = SECTORS[leg.index];
    const a = clamp(Math.atan2(local.y, local.x), lo + margin, hi - margin);
    const r = Math.hypot(local.x, local.y);
    return this.fromBodySpace(leg, { x: Math.cos(a) * r, y: Math.sin(a) * r }, origin);
  }

  /** The closest point to `p` the leg could stand on: in its sector, neither too near nor too far. */
  private bringInto(leg: Leg, p: Point, shift: Point): Point {
    const q = this.toSector(leg, p, MARGIN, shift);
    const hip = this.toWorld(leg.hip);
    const hx = hip.x + shift.x;
    const hy = hip.y + shift.y;
    const d = Math.hypot(q.x - hx, q.y - hy);
    const min = NEAREST * 1.05 * this.reach;
    const max = FARTHEST * 0.97 * this.reach;
    if (d >= min && d <= max) return q;
    if (d < 1e-6) return this.restFoot(leg);
    const k = clamp(d, min, max) / d;
    return { x: hx + (q.x - hx) * k, y: hy + (q.y - hy) * k };
  }

  /** Every leg as drawn: hip, knee and foot. */
  legGeometry(): LegShape[] {
    const c = this.center();
    const k = this.size * this.scale;
    const dancing = this.pose === 'dance';
    const beat = this.time * 2.4;
    return this.legs.map((leg) => {
      const hip = this.toWorld(leg.hip);
      let foot = leg.foot;
      let planted = this.grounded && leg.t >= 1 && !leg.lifted && (this.pose === 'stand' || dancing);
      if (this.carried && leg.index === 0 && leg.side === this.carried.side) {
        foot = this.toWorld({ x: 26 * leg.side, y: -62 });
        planted = false;
      } else if (dancing) {
        // Feet tap in rhythm: the two groups alternate on the beat.
        const up = Math.max(0, Math.sin((beat + leg.group * 0.5) * Math.PI * 2));
        foot = { x: foot.x + leg.side * up * 4 * k, y: foot.y - up * 7 * k };
      }
      // A foot in the air is kept inside its sector too (a planted one never strays far out).
      if (!planted && this.grounded && this.pose === 'stand') foot = this.toSector(leg, foot, 0, ZERO);
      const lifting = leg.t < 1 ? Math.sin(leg.t * Math.PI) : leg.lifted ? 1 : 0;
      const shrink = 1 - 0.08 * lifting - 0.22 * this.fold;
      const knee = this.kneeFor(leg, hip, foot, FEMUR * k * shrink, TIBIA * k * shrink, c);
      return { hip, knee, foot, planted, word: planted ? leg.word : null };
    });
  }

  /**
   * The knee sticks out sideways, towards the side of the body (the middle
   * of the leg's half of the body), and never out of the leg's sector.
   */
  private kneeFor(leg: Leg, hip: Point, foot: Point, a: number, b: number, c: Point): Point {
    const { base, height, along } = legBend(hip, foot, a, b);
    if (height <= 0) return base;
    const out = height * KNEE_OUT;
    const k1 = { x: base.x - along.y * out, y: base.y + along.x * out };
    const k2 = { x: base.x + along.y * out, y: base.y - along.x * out };
    const sideways = (p: Point) => {
      const local = this.bodySpace(leg, p, c);
      return Math.abs(Math.atan2(local.y, local.x));
    };
    return this.toSector(leg, sideways(k1) <= sideways(k2) ? k1 : k2, deg(1.5), ZERO);
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.visible || this.scale < 0.03) return;
    const k = this.size * this.scale;
    const dancing = this.pose === 'dance';
    const beat = this.time * 2.4;

    // Cyan box around each word held by a foot.
    ctx.save();
    ctx.strokeStyle = COLORS.footBox;
    ctx.lineWidth = 1;
    for (const word of this.heldWords()) {
      const b = word.box;
      ctx.strokeRect(Math.round(b.left) - 2.5, Math.round(b.top) + 0.5, Math.round(b.right - b.left) + 4, Math.round(b.bottom - b.top) - 1);
    }
    ctx.restore();

    // Legs.
    const legs = this.legGeometry();
    ctx.save();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = Math.max(0.7, 1.5 * Math.min(1, k * 1.2));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const { hip, knee, foot } of legs) {
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.x, foot.y);
    }
    ctx.stroke();
    ctx.fillStyle = COLORS.line;
    for (const { knee } of legs) dot(ctx, knee, 2 * Math.min(1, k * 1.3));
    ctx.fillStyle = COLORS.page;
    ctx.lineWidth = Math.max(0.6, 1.5 * Math.min(1, k * 1.3));
    for (const { foot, planted } of legs) {
      // Feet in the air are drawn a little smaller.
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, (planted ? 3 : 2.3) * Math.min(1, k * 1.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Carried word, held up by the front leg.
    if (this.carried) {
      const p = this.carryPoint(this.carried.side);
      drawWordTag(ctx, this.carried.text, p.x, p.y, -0.15 * this.carried.side);
    }

    // Body: plain outlined rectangle, breathing slightly.
    const breathe = this.grounded && this.pose === 'stand' ? 1 + 0.03 * Math.sin(this.time * 2.4) : 1;
    const bob = dancing ? Math.abs(Math.sin(beat * Math.PI)) * -3 * k : 0;
    const wiggle = this.isWiggling ? Math.sin(this.time * 70) * 0.28 : 0;
    const o = this.center();
    ctx.save();
    ctx.translate(o.x, o.y + bob);
    ctx.rotate(this.tilt + wiggle);
    ctx.scale(k, k * breathe);
    ctx.fillStyle = COLORS.page;
    ctx.strokeStyle = this.rage ? '#FFD6DA' : COLORS.line;
    ctx.lineWidth = 1.5 / Math.max(0.35, k);
    ctx.fillRect(-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2);
    ctx.strokeRect(-HALF_W, -HALF_H, HALF_W * 2, HALF_H * 2);

    // The eye: one red dot with a soft glow (bigger and pulsing in rage), on
    // its track inside the body, its pupil shifted towards what it looks at.
    const blink = dancing && Math.sin(this.time * 7) > 0.92 ? 0.15 : 1;
    const open = this.eyeOpen * blink;
    if (open > 0.02) {
      const spot = this.eyeSpot();
      let px = spot.x;
      let py = spot.y;
      if (this.lookAt) {
        const eye = this.eye();
        const dx = this.lookAt.x - eye.x;
        const dy = this.lookAt.y - eye.y;
        const d = Math.hypot(dx, dy) || 1;
        const c = Math.cos(-this.tilt);
        const s = Math.sin(-this.tilt);
        px += ((dx * c - dy * s) / d) * 2.5;
        py += ((dx * s + dy * c) / d) * 2.5;
      }
      px = clamp(px, -HALF_W + 5, HALF_W - 5);
      py = clamp(py, -HALF_H + 5, HALF_H - 5);
      const pulse = this.rage ? 1 + 0.25 * Math.sin(this.time * 9) : 1;
      ctx.fillStyle = COLORS.eye;
      ctx.shadowColor = COLORS.eyeGlow;
      ctx.shadowBlur = (this.rage ? 22 : 10) * pulse;
      ctx.globalAlpha = Math.min(1, open);
      ctx.beginPath();
      ctx.ellipse(px, py, (this.rage ? 5 : 4) * pulse, (this.rage ? 5 : 4) * pulse * Math.max(0.12, open), 0, 0, Math.PI * 2);
      ctx.fill();
      if (this.rage) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.35 * open;
        ctx.strokeStyle = COLORS.eye;
        ctx.lineWidth = 1 / Math.max(0.35, k);
        ctx.beginPath();
        ctx.arc(px, py, 8 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** A word on a little tag (thrown words, covered links). */
export function drawWordTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, rotation: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = '600 17px "Source Serif 4", "Source Serif Pro", Charter, Georgia, serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = COLORS.page;
  ctx.fillRect(-w / 2, -14, w, 28);
  ctx.strokeStyle = COLORS.footBox;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-w / 2, -14, w, 28);
  ctx.fillStyle = COLORS.line;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

/**
 * How a leg of two segments (a from the hip, b to the foot) bends: the
 * point of the hip-foot line under the knee, how far the knee stands off
 * that line (0 when the leg is stretched straight), and the line's
 * direction.
 */
export function legBend(hip: Point, foot: Point, a: number, b: number): { base: Point; height: number; along: Point } {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { base: { ...hip }, height: 0, along: { x: 1, y: 0 } };
  const along = { x: dx / d, y: dy / d };
  if (d >= a + b) return { base: { x: hip.x + along.x * a, y: hip.y + along.y * a }, height: 0, along };
  const span = Math.max(d, Math.abs(a - b) + 1e-3);
  const t = clamp((a * a - b * b + span * span) / (2 * span), 0, d);
  return { base: { x: hip.x + along.x * t, y: hip.y + along.y * t }, height: Math.sqrt(Math.max(0, a * a - t * t)), along };
}

function dot(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}
