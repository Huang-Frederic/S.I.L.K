/**
 * Small static drawings for "How it works", in the style of the mockups:
 * text as flat bars (grey text, blue links), the real spider rig in a pose,
 * and the real effect primitives. Drawn once on a canvas (redrawn when the
 * web fonts are ready).
 */
import { CYAN, drawLabel, drawLaser, drawSilk, LINE, MONO, RED, strokeBox } from '../fx/fx';
import { drawWordTag, SpiderRig, type Foothold, type Ground } from '../spider/rig';
import type { Box, Point } from '../stage/stage';
import { h } from './dom';

export type IllustrationKind = 'scan' | 'crawl' | 'grab' | 'hop' | 'laser' | 'throw' | 'stomp' | 'zip';

const W = 440;
const H = 300;
const TEXT_BAR = '#2A323C';
const LINK_BAR = '#88A3E8';
const TITLE_BAR = '#C8CED6';

interface Line {
  y: number;
  words: Box[];
  links: Box[];
}

/** Deterministic random numbers, so the drawings never change. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function layout(seed: number, top = 74, rows = 6): Line[] {
  const rand = seeded(seed);
  const lines: Line[] = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * 33;
    const end = r === rows - 1 ? 180 : 360 + rand() * 40;
    const words: Box[] = [];
    const links: Box[] = [];
    let x = 26;
    while (x < end) {
      const w = 22 + rand() * 54;
      const box = { left: x, right: Math.min(x + w, end), top: y - 4, bottom: y + 4 };
      if (rand() < 0.16) links.push(box);
      words.push(box);
      x += w + 9;
    }
    lines.push({ y, words, links });
  }
  return lines;
}

function drawText(ctx: CanvasRenderingContext2D, lines: Line[], options: { title?: boolean; skip?: Box[] } = {}): void {
  if (options.title !== false) {
    ctx.fillStyle = TITLE_BAR;
    ctx.fillRect(26, 26, 190, 14);
  }
  for (const line of lines) {
    for (const word of line.words) {
      if (options.skip?.includes(word)) continue;
      ctx.fillStyle = line.links.includes(word) ? LINK_BAR : TEXT_BAR;
      ctx.fillRect(word.left, word.top, word.right - word.left, word.bottom - word.top);
    }
  }
}

function groundOf(lines: Line[], rig: SpiderRig): Ground {
  return {
    hold(desired: Point): Foothold {
      let best: Box | null = null;
      let bestD = rig.reach * 0.35;
      for (const line of lines) {
        for (const w of line.words) {
          const dx = Math.max(w.left - desired.x, 0, desired.x - w.right);
          const dy = Math.max(w.top - desired.y, 0, desired.y - w.bottom);
          const d = Math.hypot(dx, dy);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
      }
      if (!best) return { point: desired, word: null };
      return { point: { x: Math.min(Math.max(desired.x, best.left + 3), best.right - 3), y: (best.top + best.bottom) / 2 }, word: null };
    },
  };
}

/** A spider standing on the text, facing `facing` (upright by default). */
function spider(x: number, y: number, lines: Line[], size = 0.72, facing?: Point): SpiderRig {
  const rig = new SpiderRig(size);
  rig.x = x;
  rig.y = y;
  rig.visible = true;
  if (facing) {
    rig.face(facing);
    rig.tilt = rig.targetTilt;
  }
  rig.plantAll(groundOf(lines, rig));
  return rig;
}

const center = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

function caption(ctx: CanvasRenderingContext2D, text: string, color = RED, fill = false): void {
  drawLabel(ctx, text, 26, H - 26, color, { boxed: fill ? undefined : false, fill });
}

const PAINTERS: Record<IllustrationKind, (ctx: CanvasRenderingContext2D) => void> = {
  scan(ctx) {
    const lines = layout(3);
    drawText(ctx, lines);
    const rig = spider(318, 92, lines);
    const eye = rig.eye();
    const targets = lines.flatMap((l) => l.links).slice(0, 4);
    targets.forEach((link, i) => {
      ctx.globalAlpha = i === 1 ? 1 : 0.55;
      drawLaser(ctx, eye, center(link), i === 1 ? 1 : 0.5, i === 1 ? 2 : 1);
      ctx.globalAlpha = 1;
      if (i === 1) {
        strokeBox(ctx, link, CYAN, { pad: 4, glow: true });
        drawLabel(ctx, '0.82 backlink', link.left - 4, link.bottom + 16, CYAN);
      } else drawLabel(ctx, ['0.44', '', '0.61', '0.37'][i], link.left, link.top - 12, LINE, { boxed: false });
    });
    rig.draw(ctx);
    caption(ctx, 'scanning 38 links…');
  },
  crawl(ctx) {
    const lines = layout(11);
    drawText(ctx, lines);
    const row = lines[3];
    const eaten = row.words.slice(1, 4);
    for (const w of eaten) strokeBox(ctx, { ...w, top: w.top - 4, bottom: w.bottom + 4 }, RED, { dash: [3, 3], pad: 2 });
    const rig = spider(center(row.words[4]).x, row.y, lines, 0.72, { x: 1, y: 0 });
    drawSilk(ctx, [{ x: 20, y: row.y }, rig.spinneret()], 0.5);
    rig.draw(ctx);
    // Feet boxes: the words nearest to each foot.
    const feetWords = lines.flatMap((l) => l.words).filter((w) => Math.hypot(center(w).x - rig.x, center(w).y - rig.y) < 95 && Math.hypot(center(w).x - rig.x, center(w).y - rig.y) > 60).slice(0, 4);
    for (const w of feetWords) strokeBox(ctx, { ...w, top: w.top - 5, bottom: w.bottom + 5 }, CYAN, { pad: 3 });
    caption(ctx, 'eat("approach") · words_eaten: 37');
  },
  grab(ctx) {
    const lines = layout(5);
    drawText(ctx, lines);
    const link = { left: 150, right: 250, top: lines[3].y - 4, bottom: lines[3].y + 4 };
    ctx.fillStyle = LINK_BAR;
    ctx.fillRect(link.left, link.top, link.right - link.left, 8);
    strokeBox(ctx, { ...link, top: link.top - 8, bottom: link.bottom + 8 }, CYAN, { pad: 8, glow: true, width: 1.4 });
    const rig = spider(200, lines[3].y, lines);
    rig.pose = 'grab';
    rig.grabBox = { ...link, top: link.top - 10, bottom: link.bottom + 10 };
    for (let i = 0; i < 3; i++) rig.update(1, { hold: (p) => ({ point: p, word: null }) });
    rig.draw(ctx);
    ctx.fillStyle = RED;
    ctx.fillRect(4, 60, 2, 36);
    ctx.fillRect(W - 6, 150, 2, 28);
    ctx.fillStyle = CYAN;
    ctx.fillRect(W - 6, 70, 2, 22);
    ctx.fillRect(4, 190, 2, 30);
    caption(ctx, 'LOCKED · raster_graphics', RED);
  },
  hop(ctx) {
    ctx.font = `600 28px "Source Serif 4", "Source Serif Pro", Charter, Georgia, serif`;
    ctx.fillStyle = LINE;
    ctx.fillText('Raster graphics', 26, 48);
    const lines = layout(9, 104, 6);
    for (const line of lines) {
      const shift = Math.sin(line.y * 1.7) * 26;
      for (const w of line.words.filter((_, i) => i % 3 === 0)) {
        const width = Math.min(150, w.right - w.left + 60);
        ctx.fillStyle = RED;
        ctx.fillRect(w.left + shift - 4, w.top, width, 8);
        ctx.fillStyle = CYAN;
        ctx.fillRect(w.left + shift + 4, w.top, width, 8);
        ctx.fillStyle = line.links.length && w === line.words[0] ? LINK_BAR : '#3A434E';
        ctx.fillRect(w.left + shift, w.top, width, 8);
      }
    }
    ctx.fillStyle = CYAN;
    ctx.fillRect(0, 186, W, 1);
    const rig = new SpiderRig(0.72);
    rig.x = 340;
    rig.y = 84;
    rig.visible = true;
    // Head down on its thread, the eye towards where it drops.
    rig.tilt = rig.targetTilt = Math.PI;
    rig.pose = 'hang';
    rig.liftAll();
    rig.update(0.5);
    drawSilk(ctx, [{ x: 340, y: 0 }, rig.spinneret()], 0.9);
    rig.draw(ctx);
    caption(ctx, '+1 HOP · hops: 7', RED, true);
  },
  laser(ctx) {
    const lines = layout(21);
    const victim = lines[1].words[1];
    drawText(ctx, lines, { skip: [victim] });
    const cut = center(victim);
    const rig = spider(300, 190, lines, 0.72, { x: cut.x - 300, y: cut.y - 190 });
    drawLaser(ctx, rig.eye(), cut, 1);
    ctx.save();
    ctx.font = `600 22px "Source Serif 4", Charter, Georgia, serif`;
    ctx.fillStyle = LINE;
    ctx.translate(cut.x - 26, cut.y - 4);
    ctx.rotate(-0.18);
    ctx.fillText('appr', -30, 0);
    ctx.restore();
    ctx.save();
    ctx.font = `600 22px "Source Serif 4", Charter, Georgia, serif`;
    ctx.fillStyle = LINE;
    ctx.translate(cut.x + 8, cut.y + 8);
    ctx.rotate(0.16);
    ctx.fillText('oach', 0, 0);
    ctx.restore();
    ctx.fillStyle = RED;
    ctx.fillRect(cut.x - 4, cut.y + 10, 3, 3);
    ctx.fillRect(cut.x + 3, cut.y - 16, 2, 2);
    rig.draw(ctx);
    caption(ctx, 'eye.laser(word) → cut');
  },
  throw(ctx) {
    const lines = layout(17);
    const holes = [lines[3].words[2], lines[4].words[3]];
    drawText(ctx, lines, { skip: holes });
    for (const hole of holes) strokeBox(ctx, { ...hole, top: hole.top - 6, bottom: hole.bottom + 6 }, CYAN, { dash: [3, 3] });
    const rig = spider(200, 200, lines);
    rig.carried = { text: 'colour', side: 1 };
    rig.draw(ctx);
    ctx.strokeStyle = 'rgba(240, 244, 248, 0.4)';
    for (const off of [0, 12, 24]) {
      ctx.beginPath();
      ctx.moveTo(300 + off, 90 - off * 0.2);
      ctx.lineTo(332 + off, 64 - off * 0.2);
      ctx.stroke();
    }
    drawWordTag(ctx, 'scenes', 370, 46, 0.42);
    caption(ctx, 'grab(word).throw()', CYAN);
  },
  stomp(ctx) {
    const lines = layout(29);
    const word = lines[4].words[3];
    drawText(ctx, lines, { skip: [word] });
    const c = center(word);
    const rig = spider(c.x - 60, c.y - 70, lines, 0.72, { x: 60, y: 70 });
    rig.draw(ctx);
    ctx.strokeStyle = LINE;
    for (const [r, a] of [
      [12, 0.9],
      [24, 0.5],
      [38, 0.25],
    ] as const) {
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(c.x, c.y + 4);
    ctx.scale(1.3, 0.35);
    ctx.font = `600 22px "Source Serif 4", Charter, Georgia, serif`;
    ctx.fillStyle = RED;
    ctx.textAlign = 'center';
    ctx.fillText('the', 0, 0);
    ctx.restore();
    drawLabel(ctx, 'THUD', c.x + 50, c.y - 44, LINE, { boxed: false });
    caption(ctx, 'stomp(word)', CYAN);
  },
  zip(ctx) {
    const lines = layout(41, 84, 6);
    drawText(ctx, lines, { title: false });
    const tag = { x: 330, y: 44 };
    const rig = spider(100, 236, lines, 0.6, { x: tag.x - 100, y: tag.y - 236 });
    const eye = rig.eye();
    ctx.strokeStyle = 'rgba(240, 244, 248, 0.85)';
    ctx.beginPath();
    ctx.moveTo(eye.x, eye.y);
    ctx.lineTo(tag.x - 40, tag.y + 14);
    ctx.stroke();
    ctx.save();
    ctx.font = MONO;
    ctx.fillStyle = LINE;
    ctx.fillText('zip →', 228, 140);
    ctx.restore();
    rig.draw(ctx);
    ctx.save();
    ctx.translate(tag.x, tag.y);
    ctx.font = `600 18px "Source Serif 4", Charter, Georgia, serif`;
    const w = ctx.measureText('raster graphics').width + 18;
    ctx.fillStyle = '#101418';
    ctx.fillRect(-w / 2, -15, w, 30);
    ctx.strokeStyle = CYAN;
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 8;
    ctx.strokeRect(-w / 2, -15, w, 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = LINE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('raster graphics', 0, 1);
    ctx.restore();
    drawLabel(ctx, 'web.shoot(link).zip()', 250, H - 26, LINE, { boxed: false });
  },
};

export function illustration(kind: IllustrationKind): HTMLCanvasElement {
  const canvas = h('canvas', { class: 'how-art', attrs: { width: String(W * 2), height: String(H * 2), 'aria-hidden': 'true' } });
  const paint = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, W, H);
    PAINTERS[kind](ctx);
  };
  paint();
  document.fonts?.ready.then(paint).catch(() => {});
  return canvas;
}
