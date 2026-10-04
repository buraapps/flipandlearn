#!/usr/bin/env node
/**
 * check-abc-hero.mjs — layout check for the floating letter tiles (Ș, ß, Gy, Ñ) in the
 * hero of the Flip & Learn ABC pages (FLI-411). Run it after every change to the ABC
 * template and after every new locale batch.
 *
 * For every locale in ABC_LOCALES (read from build-locales.js) and every width below,
 * with the float animation frozen at its start, middle and peak, it requires:
 *   1. no overlap  — 0 px² between each tile and every text node, chip, button, link
 *                    and the status line in the hero (the faint giant background
 *                    letters, .decor, are decoration and are not counted);
 *   2. no clipping — each tile's whole box lies inside every clipping ancestor
 *                    (overflow other than visible, clip-path, contain: paint) and
 *                    inside the viewport width;
 *   3. 0 px² between each tile and the phone screenshot.
 * It also reports the smallest gap between a tile and any of those hero elements.
 *
 * Usage (from the repo root; the built pages are served by a small built-in server):
 *   PLAYWRIGHT_DIR=/path/to/node_modules node tools/check-abc-hero.mjs
 *   ... --locales=en,hu          only these locales
 *   ... --widths=390,1280        only these widths
 *   ... --crops=en:390,430 --out=audits/abc-en-hero --tag=after
 *                                also save hero crops (tiles at their peak) as
 *                                <out>-<width>-<tag>.png
 * Playwright is not a dependency of this repo: point PLAYWRIGHT_DIR at any
 * node_modules folder that contains it (or install it where Node can resolve it).
 * Exit code 0 = every page passes, 1 = at least one failure, 2 = cannot run.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [320, 360, 375, 390, 393, 412, 414, 428, 430, 768, 1024, 1280, 1440];
const PHASES = [['start', 0], ['middle', 0.25], ['peak', 0.5]];

const arg = name => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'playwright') : 'playwright'));
} catch (e) {
  console.error('Playwright not found. Set PLAYWRIGHT_DIR to a node_modules folder that contains it.');
  process.exit(2);
}

const src = fs.readFileSync(path.join(ROOT, 'build-locales.js'), 'utf8');
const m = /const ABC_LOCALES = new Set\(\[([^\]]*)\]\)/.exec(src);
if (!m) { console.error('ABC_LOCALES not found in build-locales.js'); process.exit(2); }
const allLocales = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
const locales = arg('locales') ? arg('locales').split(',') : allLocales;
const widths = arg('widths') ? arg('widths').split(',').map(Number) : WIDTHS;
const crops = arg('crops') ? { loc: arg('crops').split(':')[0], widths: arg('crops').split(':')[1].split(',').map(Number) } : null;
const pagePath = loc => (loc === 'en' ? '/abc/' : `/${loc}/abc/`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Runs in the page: freeze the tiles at one phase and measure them.
const measure = phase => {
  const hero = document.querySelector('.hero');
  const tiles = [...hero.querySelectorAll('.float')];
  for (const t of tiles) for (const a of t.getAnimations()) { a.pause(); a.effect.updateTiming({ delay: 0 }); a.currentTime = phase * a.effect.getTiming().duration; }
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const gap = (a, b) => { const dx = Math.max(0, b.left - a.right, a.left - b.right), dy = Math.max(0, b.top - a.bottom, a.top - b.bottom); return Math.hypot(dx, dy); };
  // Obstacles: every text node, chip, button, link and the status line in the hero.
  const obstacles = [];
  const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (el.closest('.float') || el.closest('.decor')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) obstacles.push({ r, what: 'text "' + n.nodeValue.trim().slice(0, 24) + '"' });
  }
  for (const el of hero.querySelectorAll('.chips li, button, a, .soon')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) obstacles.push({ r, what: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') });
  }
  const shots = document.getElementById('abcShots').getBoundingClientRect();
  const out = [];
  for (const t of tiles) {
    const r = t.getBoundingClientRect(), area = r.width * r.height;
    let overlap = 0, minGap = Infinity, worst = '';
    for (const o of obstacles) { const i = inter(r, o.r); if (i > 0) { overlap += i; worst = o.what; } const g = gap(r, o.r); if (g < minGap) minGap = g; }
    // Clipping ancestors, plus the viewport width.
    let clipped = 0, clipBy = '';
    for (let a = t.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const clips = a !== document.documentElement && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none' || /paint|strict|content/.test(cs.contain));
      if (!clips) continue;
      const lost = area - inter(r, a.getBoundingClientRect());
      if (lost > clipped + 0.5) { clipped = lost; clipBy = a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(' ')[0] : ''); }
    }
    const vp = { left: 0, right: document.documentElement.clientWidth, top: -1e9, bottom: 1e9 };
    const lostVp = area - inter(r, vp);
    if (lostVp > clipped + 0.5) { clipped = lostVp; clipBy = 'viewport'; }
    out.push({ tile: t.textContent.trim(), overlap: Math.round(overlap), worst, minGap: Math.round(minGap * 10) / 10, shot: Math.round(inter(r, shots)), clipped: Math.round(clipped), clipBy });
  }
  return out;
};

const browser = await chromium.launch();
const perWidth = new Map(widths.map(w => [w, { overlap: 0, shot: 0, clipped: 0, minGap: Infinity, fails: [] }]));
for (const loc of locales) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await ctx.route(u => u.hostname !== '127.0.0.1', r => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('fl_consent', 'rejected'); } catch (e) {} });
    const page = await ctx.newPage();
    await page.goto(base + pagePath(loc), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const agg = perWidth.get(w);
    for (const [name, phase] of PHASES) {
      for (const t of await page.evaluate(measure, phase)) {
        agg.overlap = Math.max(agg.overlap, t.overlap); agg.shot = Math.max(agg.shot, t.shot); agg.clipped = Math.max(agg.clipped, t.clipped); agg.minGap = Math.min(agg.minGap, t.minGap);
        if (t.overlap || t.shot || t.clipped) agg.fails.push(`${loc} ${name} ${t.tile}:` + (t.overlap ? ` ${t.overlap}px² on ${t.worst}` : '') + (t.shot ? ` ${t.shot}px² on the screenshot` : '') + (t.clipped ? ` ${t.clipped}px² clipped by ${t.clipBy}` : ''));
      }
    }
    if (crops && crops.loc === loc && crops.widths.includes(w)) {
      await page.locator('.hero').screenshot({ path: path.resolve(ROOT, `${arg('out') || 'audits/abc-hero'}-${w}-${arg('tag') || 'crop'}.png`) });
    }
    await ctx.close();
  }
}
await browser.close(); server.close();

console.log(`ABC hero tiles: ${locales.length} page(s) [${locales.join(' ')}], 3 animation phases each`);
console.log('width | text/chip/button overlap px² | min gap px | clipped px² | on screenshot px² | result');
let failed = 0;
for (const w of widths) {
  const a = perWidth.get(w); const ok = !a.fails.length; if (!ok) failed++;
  console.log(`${String(w).padStart(5)} | ${String(a.overlap).padStart(4)} | ${String(a.minGap).padStart(5)} | ${String(a.clipped).padStart(4)} | ${String(a.shot).padStart(4)} | ${ok ? 'PASS' : 'FAIL'}`);
  for (const f of a.fails.slice(0, 6)) console.log('        ' + f);
  if (a.fails.length > 6) console.log(`        … and ${a.fails.length - 6} more`);
}
console.log(failed ? `\nFAILED at ${failed} width(s)` : '\nPASS: all widths, all pages');
process.exit(failed ? 1 : 0);
