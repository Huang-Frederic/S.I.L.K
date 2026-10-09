/**
 * The animated title logo: "S.I.L.K" drawn as a graph. Letter strokes are
 * edges between glowing nodes, faint "web" edges join nearby nodes across
 * letters, data pulses crawl along the edges (like a crawler following
 * links), and the spider hangs from its thread beside the K.
 */
import { Crawler } from '../spider/render/crawler';
import type { Point } from '../spider/render/canvas';

type Stroke = Array<[number, number]>;

/** Letters on a grid (x right, y down), 6 units tall. */
const LETTERS: Array<{ width: number; strokes: Stroke[] }> = [
  {
    // S
    width: 4,
    strokes: [
      [
        [4, 1],
        [3, 0],
        [1, 0],
        [0, 1],
        [0, 2],
        [1, 3],
        [3, 3],
        [4, 4],
        [4, 5],
        [3, 6],
        [1, 6],
        [0, 5],
      ],
    ],
  },
  {
    // I
    width: 2,
    strokes: [
      [
        [0, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [1, 6],
      ],
      [
        [0, 6],
        [2, 6],
      ],
    ],
  },
  {
    // L
    width: 3.4,
    strokes: [
      [
        [0, 0],
        [0, 6],
        [3.4, 6],
      ],
    ],
  },
  {
    // K
    width: 3.8,
    strokes: [
      [
        [0, 0],
        [0, 6],
      ],
      [
        [3.8, 0],
        [0, 3.6],
      ],
      [
        [1.3, 2.4],
        [3.8, 6],
      ],
    ],
  },
];

const LETTER_GAP = 1.1;
const DOT_GAP = 1.1;

interface Edge {
  a: number;
  b: number;
}

interface Pulse {
  edge: number;
  forward: boolean;
  t: number;
  speed: number;
}

export class Logo {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private nodes: Point[] = [];
  private dots: Point[] = [];
  private edges: Edge[] = [];
  private webEdges: Edge[] = [];
  private pulses: Pulse[] = [];
  private readonly spider = new Crawler();
  private anchor: Point = { x: 0, y: 0 };
  private width = 0;
  private height = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private readonly still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'logo-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    this.element = document.createElement('div');
    this.element.className = 'logo';
    this.element.append(this.canvas);
    this.spider.liftAll();
    this.spider.heading = Math.PI / 2;
    this.spider.tuck = 0.35;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Lays the letters out to fit the current width. */
  private layout(): void {
    const width = Math.min(620, this.element.clientWidth || 600);
    const units = LETTERS.reduce((sum, l) => sum + l.width, 0) + LETTER_GAP * 3 + DOT_GAP * 3 + 3.2;
    const unit = Math.max(10, Math.min(24, (width * 0.82) / units));
    const height = Math.round(unit * 6 + 70);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const totalWidth = units * unit - 3.2 * unit;
    let x = (width - totalWidth) / 2 - unit * 1.2;
    const top = 44;
    const nodes: Point[] = [];
    const index = new Map<string, number>();
    const nodeAt = (p: Point) => {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (!index.has(key)) {
        index.set(key, nodes.length);
        nodes.push(p);
      }
      return index.get(key)!;
    };
    const edges: Edge[] = [];
    const dots: Point[] = [];
    LETTERS.forEach((letter, i) => {
      for (const stroke of letter.strokes) {
        for (let j = 1; j < stroke.length; j++) {
          const a = nodeAt({ x: x + stroke[j - 1][0] * unit, y: top + stroke[j - 1][1] * unit });
          const b = nodeAt({ x: x + stroke[j][0] * unit, y: top + stroke[j][1] * unit });
          edges.push({ a, b });
        }
      }
      x += letter.width * unit;
      if (i < LETTERS.length - 1) {
        dots.push({ x: x + DOT_GAP * unit * 0.55, y: top + 6 * unit });
        x += (LETTER_GAP + DOT_GAP) * unit;
      }
    });
    // Faint web: join nodes of neighbouring letters that are close enough.
    const webEdges: Edge[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d > unit * 1.6 && d < unit * 3.4 && Math.abs(nodes[i].x - nodes[j].x) > unit * 1.2) webEdges.push({ a: i, b: j });
      }
    }
    this.nodes = nodes;
    this.dots = dots;
    this.edges = edges;
    this.webEdges = webEdges;
    this.pulses = Array.from({ length: 7 }, (_, i) => ({ edge: (i * 5) % edges.length, forward: i % 2 === 0, t: Math.random(), speed: 1.1 + Math.random() }));

    // The spider hangs to the right of the K.
    this.anchor = { x: Math.min(width - 50, x + unit * 1.6), y: 0 };
    this.spider.size = Math.max(0.42, Math.min(0.62, unit / 34));
    this.spider.x = this.anchor.x;
    this.spider.y = top + unit * 3;
  }

  private frame = (now: number): void => {
    if (!this.element.isConnected && this.last) {
      cancelAnimationFrame(this.raf);
      return; // the title screen was closed
    }
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.still) this.time += dt;
    this.layout();
    this.update(dt);
    this.draw();
  };

  private update(dt: number): void {
    if (this.still) return;
    for (const pulse of this.pulses) {
      pulse.t += dt * pulse.speed;
      if (pulse.t < 1) continue;
      // Crawl on to an edge connected to the node we reached.
      const edge = this.edges[pulse.edge];
      const node = pulse.forward ? edge.b : edge.a;
      const next = this.edges.map((e, i) => ({ e, i })).filter(({ e, i }) => i !== pulse.edge && (e.a === node || e.b === node));
      const pick = next.length ? next[Math.floor(Math.random() * next.length)] : { e: this.edges[Math.floor(Math.random() * this.edges.length)], i: -1 };
      pulse.edge = pick.i >= 0 ? pick.i : this.edges.indexOf(pick.e);
      pulse.forward = pick.e.a === node || pick.i < 0;
      pulse.t = 0;
    }
    // The spider bobs on its thread.
    const baseY = 44 + (this.height - 70) * 0.55;
    this.spider.y = baseY + Math.sin(this.time * 1.3) * 7;
    this.spider.heading = Math.PI / 2 + Math.sin(this.time * 0.9) * 0.12;
    this.spider.tuck = 0.3 + 0.08 * Math.sin(this.time * 2.1);
    this.spider.update(dt, { hold: (p) => ({ point: p, link: null }) });
  }

  private draw(): void {
    const { ctx, nodes } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = 'round';

    // Web edges.
    ctx.strokeStyle = 'rgba(94, 230, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const e of this.webEdges) {
      ctx.moveTo(nodes[e.a].x, nodes[e.a].y);
      ctx.lineTo(nodes[e.b].x, nodes[e.b].y);
    }
    ctx.stroke();

    // Letter edges.
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 246, 255, 0.95)';
    ctx.lineWidth = 2.4;
    ctx.shadowColor = 'rgba(94, 230, 255, 0.9)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (const e of this.edges) {
      ctx.moveTo(nodes[e.a].x, nodes[e.a].y);
      ctx.lineTo(nodes[e.b].x, nodes[e.b].y);
    }
    ctx.stroke();
    ctx.restore();

    // Nodes.
    for (const n of nodes) {
      ctx.fillStyle = '#05070b';
      ctx.strokeStyle = '#5ee6ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Dots between letters: pink nodes.
    ctx.save();
    ctx.fillStyle = '#ff3d7f';
    ctx.shadowColor = '#ff3d7f';
    ctx.shadowBlur = 12;
    for (const d of this.dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Data pulses crawling along the letters.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pulse of this.pulses) {
      const e = this.edges[pulse.edge];
      const [from, to] = pulse.forward ? [nodes[e.a], nodes[e.b]] : [nodes[e.b], nodes[e.a]];
      const t = this.still ? 0.5 : pulse.t;
      const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      const tail = Math.max(0, t - 0.25);
      const q = { x: from.x + (to.x - from.x) * tail, y: from.y + (to.y - from.y) * tail };
      ctx.strokeStyle = 'rgba(255, 61, 127, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The spider and its thread.
    const s = this.spider;
    const rear = s.spinneret();
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 246, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.anchor.x, this.anchor.y);
    ctx.lineTo(rear.x, rear.y);
    ctx.stroke();
    ctx.restore();
    s.draw(ctx);
  }
}
