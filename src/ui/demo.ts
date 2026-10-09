/**
 * The live demo on the title screen: the spider crawling over a paragraph
 * about web crawlers, with its little debug HUD. Same rig and effects as in
 * the race, on a small stage of its own: it scans, locks a word with its
 * eye laser, walks there with its feet on the words, eats it, and starts
 * again (the words grow back after a while).
 */
import { CYAN, drawLaser, Fragments, LINE, RED, strokeBox } from '../fx/fx';
import { t } from '../i18n';
import { SpiderRig, type Foothold } from '../spider/rig';
import { Stage, StageClosedError, Z, type Box, type Point } from '../stage/stage';
import { EATEN_CLASS, WordIndex, type Word } from '../stage/wordIndex';
import { h } from './dom';

const center = (b: Box): Point => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

export class TitleDemo {
  /** The whole card: a header bar with the HUD, and the stage below it. */
  readonly element: HTMLElement;
  /** Where the spider lives (the stage's root). */
  private readonly body: HTMLElement;
  private stage: Stage | null = null;
  private readonly text: HTMLElement;
  private readonly hud: Record<'state' | 'links' | 'match', HTMLElement>;

  constructor() {
    const demo = t().demo;
    this.text = h('p', { class: 'demo-text', attrs: { lang: t().htmlLang } }, ...demo.text.map((part) => (typeof part === 'string' ? part : h('strong', { text: part.strong }))));
    const stat = (key: string, value: HTMLElement) => h('span', { class: 'demo-stat' }, h('span', { class: 'demo-key', text: key }), ' = ', value);
    this.hud = {
      state: h('span', { class: 'demo-state', text: demo.states.boot }),
      links: h('span', { class: 'demo-value', text: '0' }),
      match: h('span', { class: 'demo-value', text: '0.00' }),
    };
    this.body = h('div', { class: 'demo-body' }, this.text);
    this.element = h(
      'figure',
      { class: 'demo-card panel', attrs: { 'aria-hidden': 'true' } },
      h(
        'figcaption',
        { class: 'demo-bar' },
        h('span', { class: 'demo-live', text: demo.live }),
        h('span', { class: 'demo-hud' }, stat('crawler.state', this.hud.state), stat('links_found', this.hud.links), stat('best_match', this.hud.match)),
      ),
      this.body,
    );
  }

  /** Starts the animation (call once the element is in the document). */
  start(): void {
    if (this.stage) return;
    const stage = new Stage(this.body);
    this.stage = stage;
    void this.run(stage).catch((error) => {
      if (!(error instanceof StageClosedError)) console.error(error);
    });
  }

  destroy(): void {
    this.stage?.destroy();
    this.stage = null;
  }

  private async run(stage: Stage): Promise<void> {
    // Wait for layout (fonts, size).
    while (stage.width < 50) await stage.frame();
    const rootBox = () => this.body.getBoundingClientRect();
    const words = new WordIndex((rect) => {
      const r = rootBox();
      return { left: rect.left - r.left, top: rect.top - r.top, right: rect.right - r.left, bottom: rect.bottom - r.top };
    });
    const relayout = () => {
      // reset() indexes the text blocks inside the element it is given.
      words.reset(this.body);
      words.ensure({ left: -1e4, right: 1e4, top: -1e4, bottom: 1e4 });
    };
    relayout();
    let width = stage.width;

    const fragments = new Fragments();
    stage.add(fragments);
    const rig = new SpiderRig(1.45);
    const textBox = () => {
      const r = rootBox();
      const t = this.text.getBoundingClientRect();
      return { left: t.left - r.left, top: t.top - r.top, right: t.right - r.left, bottom: t.bottom - r.top };
    };
    const ground = {
      hold: (desired: Point, accept?: (p: Point) => boolean): Foothold | null => {
        const on = (b: Box) => ({ x: Math.min(Math.max(desired.x, b.left + 3), b.right - 3), y: b.top + (b.bottom - b.top) * 0.62 });
        const word = words.nearest(desired, rig.reach * 0.5, (w) => !w.gone && (!accept || accept(on(w.box))));
        return word ? { point: on(word.box), word } : null;
      },
    };
    let rays: Array<{ to: Point; age: number }> = [];
    let lock: Word | null = null;
    let laser = 0;
    stage.add({
      z: Z.spider,
      update: (dt) => {
        rig.update(dt, ground);
        rays.forEach((r) => (r.age += dt));
        rays = rays.filter((r) => r.age < 0.5);
        laser = Math.max(0, laser - dt);
        // Words under the feet light up.
        const held = new Set(rig.heldWords().map((w) => w.el));
        for (const w of words.all()) w.el.classList.toggle('is-held', held.has(w.el));
      },
      draw: (ctx) => {
        const eye = rig.eye();
        ctx.strokeStyle = RED;
        for (const ray of rays) {
          ctx.globalAlpha = 0.7 * (1 - ray.age / 0.5);
          ctx.beginPath();
          ctx.moveTo(eye.x, eye.y);
          ctx.lineTo(ray.to.x, ray.to.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (lock) {
          strokeBox(ctx, lock.box, RED, { dash: [3, 3], pad: 3 });
          if (laser > 0) drawLaser(ctx, eye, center(lock.box), Math.min(1, laser * 3));
        }
        rig.draw(ctx);
      },
    });

    const start = textBox();
    rig.x = start.left + (start.right - start.left) * 0.55;
    rig.y = start.top + (start.bottom - start.top) * 0.45;
    rig.visible = true;
    rig.plantAll(ground);
    let eaten: Word[] = [];

    for (;;) {
      if (Math.abs(stage.width - width) > 2) {
        width = stage.width;
        relayout();
        eaten = [];
        rig.plantAll(ground);
      }
      // 01 scan
      this.hud.state.textContent = t().demo.states.scan;
      this.hud.state.className = 'demo-state is-scan';
      const candidates = words.all().filter((w) => !w.gone && (w.el.textContent?.length ?? 0) >= 4);
      let found = 0;
      for (let i = 0; i < 18; i++) {
        const w = candidates[Math.floor(Math.random() * candidates.length)];
        if (w) rays.push({ to: center(w.box), age: 0 });
        rig.lookAt = w ? center(w.box) : null;
        found += 7 + Math.floor(Math.random() * 9);
        this.hud.links.textContent = String(found);
        await stage.wait(0.07);
      }
      const near = candidates
        .map((w) => ({ w, d: Math.hypot(center(w.box).x - rig.x, center(w.box).y - rig.y) }))
        .filter((c) => c.d > 60 && c.d < 260)
        .sort(() => Math.random() - 0.5);
      const target = near[0]?.w ?? candidates[0];
      if (!target) {
        await stage.wait(1);
        continue;
      }
      this.hud.match.textContent = (0.62 + Math.random() * 0.33).toFixed(2);

      // Lock with the eye laser.
      lock = target;
      laser = 0.45;
      rig.lookAt = center(target.box);
      rig.face({ x: center(target.box).x - rig.x, y: center(target.box).y - rig.y });
      this.hud.state.textContent = t().demo.states.lock;
      this.hud.state.className = 'demo-state is-lock';
      await stage.wait(0.6);

      // 02 crawl
      this.hud.state.textContent = t().demo.states.crawl;
      this.hud.state.className = 'demo-state is-crawl';
      const goal = { x: center(target.box).x - 4, y: center(target.box).y };
      let speed = 0;
      for (;;) {
        const dt = await stage.frame();
        const dx = goal.x - rig.x;
        const dy = goal.y - rig.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) break;
        speed = Math.min(75, speed + 220 * dt);
        const step = Math.min(d, Math.max(18, Math.min(speed, d * 4)) * dt);
        rig.x += (dx / d) * step;
        rig.y += (dy / d) * step;
        rig.face({ x: dx, y: dy });
      }

      // Eat.
      this.hud.state.textContent = t().demo.states.eat;
      this.hud.state.className = 'demo-state is-eat';
      target.gone = true;
      target.el.classList.add(EATEN_CLASS);
      eaten.push(target);
      const r = center(target.box);
      fragments.burst(r, { count: 10, colors: [RED, LINE, CYAN], speed: [20, 70], life: [0.25, 0.4], gravity: 60 });
      rig.wiggle(0.3);
      lock = null;
      await stage.wait(1.1);

      // The words grow back after a few meals.
      if (eaten.length >= 5) {
        for (const w of eaten) {
          w.gone = false;
          w.el.classList.remove(EATEN_CLASS);
        }
        eaten = [];
      }
    }
  }
}
