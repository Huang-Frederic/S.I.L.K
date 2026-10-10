#!/usr/bin/env node
/**
 * Showcase capture for S.I.L.K: regenerates every visual in docs/screenshots/.
 *
 *   npm run build
 *   node --experimental-strip-types scripts/showcase/capture.mjs              every shot
 *   node --experimental-strip-types scripts/showcase/capture.mjs title logo   only these
 *
 * Needs Playwright (`npm i -D playwright` and `npx playwright install chromium`),
 * ffmpeg, Python 3 for make_gif.py, which sits next to this file (`python3`, or
 * `python` on Windows, or the PYTHON environment variable), and Node 22.6+ (the
 * fake Wikipedia from tests/helpers/ is TypeScript, run as is).
 *
 * Everything is offline and plays on the same pages every time: the production
 * build is served from dist/, Wikipedia is the fake demo world of the tests plus
 * the real "Spider" article (fixtures/spider.html.gz), and the ranking model is
 * left out, so the spider plays with word matching. Its attacks stay random, so
 * the shots wait for the events they show rather than for fixed delays.
 *
 * GIFs are recorded with the Chrome DevTools screencast as lossless PNG frames
 * (only while a clip is running), then turned into a 960x540 GIF by make_gif.py.
 * Lossless frames matter: video recordings carry compression noise in every
 * frame, which makes GIFs five to ten times heavier.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { demoPages } from '../../tests/helpers/demoWorld.ts';
import { FakeWiki } from '../../tests/helpers/fakeWiki.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'docs/screenshots');
const MAKE_GIF = join(HERE, 'make_gif.py');
const PYTHON = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const DESKTOP = { width: 1920, height: 1080 };

// ─── 1. How to reach the app ────────────────────────────────────────────────
// The production build, served from dist/ under the GitHub Pages path.
const BASE_URL = 'https://silk.showcase/S.I.L.K/';
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
if (!existsSync(join(DIST, 'index.html'))) throw new Error('No production build: run `npm run build` first.');

// ─── 2. Fixtures ─────────────────────────────────────────────────────────────
/** The real "Spider" article from English Wikipedia (see fixtures/README.md). */
const SPIDER_HTML = gunzipSync(readFileSync(join(HERE, 'fixtures/spider.html.gz'))).toString('utf8');

/**
 * The fictional demo world of the tests, plus a goddess of weaving and her
 * loom: "Uttu" is linked once, near the end of the real "Spider" article, so a
 * race from Spider to the Loom of Heaven sends the spider on a long trip.
 */
function world() {
  return new FakeWiki([
    ...demoPages(),
    { title: 'Uttu', description: 'Sumerian goddess of weaving', lead: ['Uttu is the Sumerian goddess of weaving. Her temple keeps the [[Loom of Heaven]], where every thread of the world was spun.'] },
    { title: 'Loom of Heaven', description: 'Mythical loom', lead: ['The Loom of Heaven is the loom on which [[Uttu]] wove the world, one thread at a time.'] },
  ]);
}

async function setup(page) {
  const wiki = world();
  await page.route(`${BASE_URL}**`, (route) => {
    let path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/S\.I\.L\.K\//, ''));
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = join(DIST, path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await page.route(/^https:\/\/(en|fr)\.wikipedia\.org\//, async (route) => {
    const url = route.request().url();
    const headers = { 'access-control-allow-origin': '*' };
    if (/\/page\/html\/Spider$/.test(url)) return route.fulfill({ status: 200, contentType: 'text/html', body: SPIDER_HTML, headers });
    const res = await wiki.fetch(url);
    await route.fulfill({ status: res.status, body: await res.text(), headers: { ...headers, 'content-type': res.headers.get('content-type') ?? 'text/plain' } });
  });
  // No ranking model: word matching, the same on every run (and no 23 MB download).
  await page.route(/cdn\.jsdelivr\.net|huggingface\.co/, (route) => route.abort());
}

/** Fills the title screen and starts a race. */
async function startRace(page, { start, target, difficulty = 'normal' }) {
  await page.goto(BASE_URL);
  await page.fill('#field-start', start);
  await page.fill('#field-target', target);
  await page.keyboard.press('Escape');
  await page.click(`label[for=difficulty-${difficulty}]`);
  await page.click('button[type=submit]');
}

const racing = (page) => page.waitForSelector('.hud-giveup:not([disabled])', { timeout: 60_000 });
const until = (page, condition, timeout = 60_000) => page.waitForFunction(condition, null, { timeout, polling: 100 });
const spiderHopped = () => (document.querySelector('.pane.is-spider .pane-hops strong')?.textContent ?? '0') !== '0';

/**
 * Flags the spider's web zips: during a zip the camera races down its page far
 * faster than any walk (window.__zipAt is set to the time of the first one).
 */
async function watchZips(page) {
  await page.evaluate(() => {
    window.__zipAt = 0;
    let last = null;
    let fast = 0;
    const tick = () => {
      const scroller = document.querySelector('.pane.is-spider .pane-scroll');
      const top = scroller ? scroller.scrollTop : 0;
      fast = last !== null && Math.abs(top - last) > 22 ? fast + 1 : 0;
      if (fast >= 2 && !window.__zipAt) window.__zipAt = performance.now();
      last = top;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * A 16:9 crop of a pane (the player's or the spider's), from just under its
 * header: the spider's reasoning panel and the top of the article, where the
 * camera keeps the spider.
 */
const paneCrop = (owner) => async (page) => {
  const box = await page.locator(`.pane.is-${owner}`).boundingBox();
  const head = await page.locator(`.pane.is-${owner} .pane-head`).boundingBox();
  const width = Math.floor(box.width) - (Math.floor(box.width) % 2);
  const height = Math.floor((width * 9) / 16);
  return `${width}:${height}:${Math.floor(box.x)}:${Math.floor(head.y + head.height)}`;
};

// ─── 3. The shot list ────────────────────────────────────────────────────────
const SHOTS = {
  logo: {
    png: { viewport: { width: 512, height: 512 }, omitBackground: true },
    async run({ page }) {
      const svg = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8').replace('<svg ', '<svg width="512" height="512" ');
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
      return page.locator('svg');
    },
  },

  title: {
    png: {},
    async run({ page }) {
      await page.goto(BASE_URL);
      await page.fill('#field-start', 'Spider');
      await page.fill('#field-target', 'Tidewatch Observatory');
      await page.keyboard.press('Escape');
      await page.mouse.click(1700, 1000);
      // Let the demo spider get going.
      await page.waitForTimeout(3000);
    },
  },

  french: {
    png: {},
    async run({ page }) {
      await page.goto(BASE_URL);
      await page.click('.lang-option[lang=fr]');
      await page.fill('#field-start', 'Araignée');
      await page.fill('#field-target', 'Tour Eiffel');
      await page.keyboard.press('Escape');
      await page.mouse.click(1700, 1000);
      await page.waitForTimeout(3000);
    },
  },

  // A whole Hard race, condensed: the setup, the countdown, the first fan laser
  // on the player's page, the spider's first hop, the victory dance and the
  // verdict. Also saves race.png, cover.png and finish.png on the way.
  'quick-overview': {
    gif: { fps: 12, speed: 1.6 },
    async run({ page, clip, still }) {
      await page.goto(BASE_URL);
      await page.waitForTimeout(1200);
      await clip.start();
      await page.locator('#field-start').pressSequentially('Moth Orchard', { delay: 40 });
      await page.fill('#field-target', 'Tidewatch Observatory');
      await page.keyboard.press('Escape');
      await page.click('label[for=difficulty-hard]');
      await page.waitForTimeout(400);
      await page.click('button[type=submit]');
      await page.waitForSelector('.countdown', { timeout: 30_000 });
      await racing(page);
      await page.mouse.move(420, 620);
      await page.waitForTimeout(3200);
      await clip.stop();
      await still('race');
      await still('cover', { clip: { x: 0, y: 0, width: 1920, height: 960 }, resize: '1280x640' });
      // The spider's first hop: its page glitches out, the next one glitches in.
      await clip.start({ keep: 1.2 });
      await until(page, spiderHopped);
      clip.hold();
      await page.waitForTimeout(1600);
      await clip.stop();
      // The spider reaches the target: victory walk, the badge eaten, the dance.
      await page.waitForSelector('.hud-giveup[disabled]', { timeout: 180_000 });
      await clip.start();
      await page.waitForSelector('.screen-finish', { timeout: 30_000 });
      await page.waitForTimeout(1800);
      await clip.stop();
      await still('finish');
    },
  },

  // One hop on the real "Spider" article: drop in, scan, lock, crawl, grab, dive.
  'spider-hop': {
    gif: { fps: 12, speed: 1.2, crop: paneCrop('spider') },
    async run({ page, clip }) {
      await startRace(page, { start: 'Spider', target: 'Tidewatch Observatory' });
      await page.waitForSelector('.countdown', { timeout: 30_000 });
      await racing(page);
      await clip.start();
      await until(page, spiderHopped);
      await page.waitForTimeout(1500);
      await clip.stop();
    },
  },

  // The only way to the Loom of Heaven is "Uttu", near the end of the article:
  // a long trip. Three moments: the set-off, a zip ahead along the way, the
  // arrival. (The whole page scrolls in every frame of a long trip, which GIFs
  // compress badly: showing it all would weigh 15 MB.)
  'long-trip': {
    gif: { fps: 10, speed: 1.3, crop: paneCrop('spider') },
    async run({ page, clip }) {
      await startRace(page, { start: 'Spider', target: 'Loom of Heaven', difficulty: 'hard' });
      await racing(page);
      await watchZips(page);
      await clip.start();
      await page.waitForTimeout(4800);
      await clip.stop();
      await clip.start({ keep: 1.2 });
      await until(page, () => window.__zipAt > 0, 60_000);
      clip.hold();
      await page.waitForTimeout(1300);
      await clip.stop();
      await clip.start({ keep: 3 });
      await until(page, spiderHopped, 90_000);
      clip.hold();
      await page.waitForTimeout(400);
      await clip.stop();
    },
  },

  // Hard: the fan laser sweeps the player's page and burns everything it
  // crosses. The whole window: the beam comes from the spider's pane.
  'fan-laser': {
    gif: { fps: 12 },
    async run({ page, clip }) {
      await startRace(page, { start: 'Moth Orchard', target: 'Tidewatch Observatory', difficulty: 'hard' });
      await racing(page);
      // The fan is centred on the cursor.
      await page.mouse.move(470, 600);
      await clip.start({ keep: 1.6 });
      await until(page, () => document.querySelectorAll('.pane.is-player .sw-burned').length > 0);
      clip.hold();
      await page.waitForTimeout(2400);
      await clip.stop();
    },
  },

  // Hard: a fake target link hatches mini-spiders that break up the page.
  'mini-spiders': {
    gif: { fps: 12, crop: paneCrop('player') },
    async run({ page, clip }) {
      await startRace(page, { start: 'Moth Orchard', target: 'Tidewatch Observatory', difficulty: 'hard' });
      await racing(page);
      await page.mouse.move(1500, 110);
      await until(page, () => !!document.querySelector('.pane.is-player a.is-decoy:not(.is-damaged)'));
      const box = await page.evaluate(() => {
        const decoy = document.querySelector('.pane.is-player a.is-decoy:not(.is-damaged)');
        decoy.scrollIntoView({ block: 'center' });
        const r = decoy.getClientRects()[0];
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.waitForTimeout(300);
      await clip.start();
      await page.mouse.move(box.x, box.y, { steps: 8 });
      await page.mouse.click(box.x, box.y);
      await page.mouse.move(1500, 110, { steps: 5 });
      await page.waitForTimeout(6500);
      await clip.stop();
    },
  },
};

// ─── Machinery (no need to edit) ────────────────────────────────────────────

/** Records lossless frames while started; any number of start/stop moments. */
class Clip {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = [];
    this.recording = false;
    this.cdp = null;
  }

  async start({ keep = Infinity } = {}) {
    if (this.recording) return;
    this.cdp ??= await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (frame) => this.onFrame(frame));
    this.recording = true;
    this.keep = keep;
    this.momentStart = this.frames.length;
    await this.cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  }

  /** Stops dropping old frames: the event is here, keep its run-up. */
  hold() {
    this.keep = Infinity;
  }

  async stop() {
    if (!this.recording) return;
    this.recording = false;
    await this.cdp.send('Page.stopScreencast');
    this.cdp.removeAllListeners('Page.screencastFrame');
    // The last frame of a moment is shown for 1/12 s before the next moment.
    if (this.frames.length) this.frames[this.frames.length - 1].last = true;
  }

  onFrame({ data, sessionId, metadata }) {
    if (!this.recording) return;
    const file = join(this.dir, `f${String(this.count = (this.count ?? 0) + 1).padStart(6, '0')}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    this.frames.push({ file, t: metadata.timestamp });
    // A rolling window: forget this moment's frames older than `keep` seconds.
    while (this.frames.length - this.momentStart > 1 && metadata.timestamp - this.frames[this.momentStart].t > this.keep) {
      rmSync(this.frames[this.momentStart].file, { force: true });
      this.frames.splice(this.momentStart, 1);
    }
    this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  }

  /** Writes the frames as a lossless 30 fps video and returns its path. */
  toVideo() {
    if (this.frames.length < 2) throw new Error('A GIF needs at least two frames: call clip.start() and clip.stop() around something that moves.');
    let list = '';
    this.frames.forEach((frame, i) => {
      const next = this.frames[i + 1];
      const duration = !next || frame.last ? 1 / 12 : Math.max(1 / 60, next.t - frame.t);
      list += `file '${frame.file}'\nduration ${duration.toFixed(4)}\n`;
    });
    list += `file '${this.frames[this.frames.length - 1].file}'\n`;
    const listFile = join(this.dir, 'frames.txt');
    writeFileSync(listFile, list);
    const video = join(this.dir, 'clip.mkv');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-r', '30', '-c:v', 'ffv1', video]);
    return video;
  }
}

/** Saves a PNG of the page (or of `locator`), resized when asked ('1280x640'). */
async function savePng(page, name, options = {}, locator = null) {
  const path = join(OUT, `${name}.png`);
  const shotOptions = { path, omitBackground: !!options.omitBackground, fullPage: !!options.fullPage, clip: options.clip };
  if (locator) await locator.screenshot(shotOptions);
  else await page.screenshot(shotOptions);
  if (options.resize) {
    const [w, h] = options.resize.split('x');
    const tmp = `${path}.tmp.png`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path, '-vf', `scale=${w}:${h}:flags=lanczos`, tmp]);
    renameSync(tmp, path);
  }
  console.log(path);
}

async function capture(browser, name, shot) {
  const options = shot.png ?? shot.gif ?? {};
  const context = await browser.newContext({ viewport: options.viewport ?? DESKTOP, deviceScaleFactor: options.scale ?? 1 });
  const page = await context.newPage();
  await setup(page);
  const dir = mkdtempSync(join(tmpdir(), `showcase-${name}-`));
  try {
    if (shot.gif) {
      const clip = new Clip(page, dir);
      const still = (stillName, stillOptions = {}, locator = null) => savePng(page, stillName, stillOptions, locator);
      await shot.run({ page, clip, still });
      await clip.stop();
      // The crop may depend on the layout: a function of the page is allowed.
      const crop = typeof shot.gif.crop === 'function' ? await shot.gif.crop(page) : shot.gif.crop;
      const args = [MAKE_GIF, clip.toVideo(), join(OUT, `${name}.gif`), '--fps', String(shot.gif.fps ?? 12), '--speed', String(shot.gif.speed ?? 1)];
      if (crop) args.push('--crop', crop);
      if (shot.gif.pad) args.push('--pad', shot.gif.pad);
      execFileSync(PYTHON, args, { stdio: 'inherit' });
    } else {
      // run() may return a locator to capture just that element.
      const target = await shot.run({ page });
      await savePng(page, name, options, target && typeof target.screenshot === 'function' ? target : null);
    }
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const wanted = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`\n▶ ${name}`);
    await capture(browser, name, shot);
  }
} finally {
  await browser.close();
}
