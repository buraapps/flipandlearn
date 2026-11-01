// Printable sheet pages. Run from the web folder: node --test tests/printables.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const P = require('../build-printables.js');
const { S } = require('../printables-strings.js');

const registry = () => P.loadRegistry(ROOT);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'printables-'));
const APP_TITLES = {
  en: 'Flip & Learn: Word Card Game',
  de: 'Flip & Learn: Wortkartenspiel',
  ro: 'Flip & Learn: Joc de cuvinte',
  es: 'Flip & Learn: Juego de cartas',
};
const PILOT_CATEGORIES = ['animals', 'numbers'];
const PILOT_LOCALES = ['en', 'de'];
const isPilot = (row, locale) => PILOT_CATEGORIES.includes(row.category) && PILOT_LOCALES.includes(locale);
const SAMPLE_COPY = { intro: 'First paragraph.', tracingTips: 'Second paragraph.', activityIdeas: ['One idea.', 'Another idea.'] };
const COUNTS = { animals: 5, fruits: 5, vegetables: 5, nature: 5, numbers: 10, halloween: 5 };

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function visibleText(html) {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}
function canonical(html) {
  return /<link rel="canonical" href="([^"]+)">/.exec(html)[1];
}
function hreflangs(html) {
  return [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => ({ lang: m[1], href: m[2] }));
}
function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
// Reads every generated page of a preview build into { relPath: html }.
function readPreview(opts) {
  const out = tmp();
  const written = P.buildPreview({ root: ROOT, outRoot: out, ...opts });
  const pages = {};
  for (const rel of written) pages[rel] = fs.readFileSync(path.join(out, rel), 'utf8');
  return { out, pages };
}
function sheetPages(pages) {
  return Object.entries(pages).filter(([rel]) => rel !== `${P.PREVIEW_DIR}/index.html`);
}
function treeHash(dir) {
  const hash = require('crypto').createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else { hash.update(path.relative(dir, p)); hash.update(fs.readFileSync(p)); }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const ALL_PILOT = () => readPreview({ locales: ['en', 'de'], categories: P.CATEGORY_ORDER });
const ALL_LOCALES = () => readPreview({ locales: P.LOCALE_ORDER, categories: P.CATEGORY_ORDER });

// ---------------------------------------------------------------- registry

test('registry: 35 concepts with the expected categories and indices', () => {
  const rows = registry();
  assert.equal(rows.length, 35);
  for (const [category, count] of Object.entries(COUNTS)) {
    const inCat = rows.filter((r) => r.category === category);
    assert.equal(inCat.length, count, category);
    assert.deepEqual(inCat.map((r) => r.index), Array.from({ length: count }, (_, i) => i + 1), category);
  }
  assert.equal(new Set(rows.map((r) => r.id)).size, 35);
});

test('registry: every pdf and thumb exists, and folders hold nothing unregistered', () => {
  const seen = new Set();
  for (const row of registry()) {
    for (const locale of P.LOCALE_ORDER) {
      const e = row.locales[locale];
      assert.ok(fs.existsSync(path.join(ROOT, e.pdf)), e.pdf);
      assert.ok(fs.existsSync(path.join(ROOT, e.thumb)), e.thumb);
      seen.add(e.pdf);
    }
  }
  assert.equal(seen.size, 105);
  for (const dir of ['printables', 'printables/ro-de', 'printables/es-en']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.pdf'))) {
      assert.ok(seen.has(`/${dir}/${f}`), `unregistered ${dir}/${f}`);
    }
  }
});

test('registry: sets align by category and index, and EN and DE share files', () => {
  for (const row of registry()) {
    const idx = String(row.index).padStart(2, '0');
    for (const locale of P.LOCALE_ORDER) {
      assert.match(path.basename(row.locales[locale].pdf), new RegExp(`^flipandlearn_[a-z]+_${idx}_`), `${row.id} ${locale}`);
    }
    assert.equal(row.locales.en.pdf, row.locales.de.pdf, row.id);
    assert.equal(row.locales.en.thumb, row.locales.de.thumb, row.id);
    assert.equal(row.locales.en.words[0], row.locales.de.words[1], row.id);
    assert.equal(row.locales.de.words[0], row.locales.en.words[1], row.id);
  }
});

test('registry: words match the text each hub shows for that PDF', () => {
  for (const locale of P.LOCALE_ORDER) {
    const html = fs.readFileSync(path.join(ROOT, P.HUB_PATHS[locale].slice(1), 'index.html'), 'utf8');
    for (const row of registry()) {
      const e = row.locales[locale];
      const re = new RegExp(`<img src="${e.thumb}"[^>]*>\\s*<span class="sheet-word">([^<]*)</span>`);
      const m = re.exec(html);
      assert.ok(m, `${e.pdf} not on the ${locale} hub`);
      assert.equal(m[1], e.words.join(' / '), `${row.id} ${locale}`);
    }
  }
});

test('registry: published set is exactly the 30 pilot pages, and copy exists only for them', () => {
  for (const row of registry()) {
    for (const locale of P.LOCALE_ORDER) {
      assert.equal(row.locales[locale].published, isPilot(row, locale), `${row.id} ${locale}`);
      if (isPilot(row, locale)) assert.ok(P.hasCopy(row.locales[locale]), `${row.id} ${locale}`);
      else assert.equal(row.locales[locale].copy, '', `${row.id} ${locale}`);
    }
  }
});

test('hub paths match PRINTABLES_PATHS in build-locales.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-locales.js'), 'utf8');
  const m = /const PRINTABLES_PATHS = (\{[^}]+\});/.exec(src);
  assert.ok(m);
  assert.deepEqual(eval(`(${m[1]})`), P.HUB_PATHS);
});

// ---------------------------------------------------------------- slugs

test('slugs: ASCII only, unique per locale, and match the URL scheme', () => {
  const suffix = { en: 'coloring-page', de: 'ausmalbild', ro: 'fisa-de-colorat', es: 'ficha-para-colorear' };
  for (const locale of P.LOCALE_ORDER) {
    const slugs = registry().map((r) => r.locales[locale].slug);
    assert.equal(new Set(slugs).size, 35, locale);
    for (const row of registry()) {
      const e = row.locales[locale];
      assert.match(e.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, e.slug);
      assert.ok(e.slug.endsWith(`-${suffix[locale]}`), e.slug);
      assert.equal(e.slug, P.slugFor(locale, e.words[0]));
    }
  }
});

test('slugs: transliteration rules', () => {
  const cases = { Kürbis: 'kuerbis', Fünf: 'fuenf', Größe: 'groesse', Äpfel: 'aepfel', Mătură: 'matura', Lămâie: 'lamaie', Șase: 'sase', Rață: 'rata', Araña: 'arana', Árbol: 'arbol', Maíz: 'maiz', Înger: 'inger' };
  for (const [word, slug] of Object.entries(cases)) assert.equal(P.transliterate(word), slug);
});

// ---------------------------------------------------------------- publishing gate

function allUnpublished() {
  const rows = registry();
  for (const row of rows) for (const locale of P.LOCALE_ORDER) row.locales[locale].published = false;
  return rows;
}

function withPublished(id, locale, copy) {
  const rows = allUnpublished();
  const e = rows.find((r) => r.id === id).locales[locale];
  e.published = true;
  e.copy = copy;
  return rows;
}

test('published build refuses a page with empty copy and writes nothing', () => {
  for (const copy of ['', '   \n ', {}, { intro: 'x', tracingTips: ' ', activityIdeas: ['y'] }, { intro: 'x', tracingTips: 'y', activityIdeas: [] }, { intro: 'x', tracingTips: 'y', activityIdeas: [''] }]) {
    const out = tmp();
    assert.throws(
      () => P.buildPublished({ root: ROOT, outRoot: out, registry: withPublished('animals-01', 'en', copy) }),
      /animals-01\/en is published but its copy slot is empty/
    );
    assert.deepEqual(fs.readdirSync(out), []);
  }
});

test('published build writes an indexable page once copy exists', () => {
  const out = tmp();
  const written = P.buildPublished({ root: ROOT, outRoot: out, registry: withPublished('animals-01', 'en', SAMPLE_COPY) });
  assert.deepEqual(written, ['en/printables/cat-coloring-page/index.html']);
  const html = fs.readFileSync(path.join(out, written[0]), 'utf8');
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.ok(html.includes('<p>First paragraph.</p>') && html.includes('<p>Second paragraph.</p>'));
  assert.ok(html.includes('<li>One idea.</li>') && html.includes('<li>Another idea.</li>'));
  assert.ok(!html.includes('COPY PENDING') && !html.includes('PREVIEW'));
  assert.ok(html.includes('cloudflareinsights'), 'published pages keep the hub analytics tag');
  // Nothing else is published: no hreflang or link to an unbuilt page.
  assert.deepEqual(hreflangs(html).map((h) => h.lang), ['en', 'x-default']);
  assert.ok(!html.includes('dog-coloring-page'));
});

test('zero published rows: normal build writes nothing, sitemap hook is empty', () => {
  const out = tmp();
  assert.deepEqual(P.buildPublished({ root: ROOT, outRoot: out, registry: allUnpublished() }), []);
  assert.deepEqual(fs.readdirSync(out), []);
  assert.deepEqual(P.printableSheetSitemapEntries(allUnpublished()), []);
});

// ---------------------------------------------------------------- preview

test('preview: pilot writes 30 pages plus a contact sheet that links them all', () => {
  const { pages } = readPreview({ locales: ['en', 'de'], categories: ['animals', 'numbers'] });
  const sheets = sheetPages(pages);
  assert.equal(sheets.length, 30);
  const contact = pages[`${P.PREVIEW_DIR}/index.html`];
  for (const [rel] of sheets) {
    const href = `/${rel.replace(/index\.html$/, '')}`;
    assert.ok(contact.includes(`href="${href}"`), href);
  }
  assert.match(contact, /noindex,nofollow/);
});

test('preview: rows without copy show a visible COPY PENDING, pilot rows do not', () => {
  const pending = sheetPages(readPreview({ locales: ['en', 'de'], categories: ['fruits'] }).pages);
  assert.equal(pending.length, 10);
  for (const [rel, html] of pending) assert.ok(visibleText(html).includes('COPY PENDING'), rel);
  const written = sheetPages(readPreview({ locales: ['en', 'de'], categories: PILOT_CATEGORIES }).pages);
  assert.equal(written.length, 30);
  for (const [rel, html] of written) assert.ok(!html.includes('COPY PENDING'), rel);
});

test('preview: noindex, no analytics beacon, links stay real', () => {
  const { pages, out } = readPreview({ locales: ['en', 'de'], categories: ['animals', 'numbers'] });
  for (const [rel, html] of sheetPages(pages)) {
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/, rel);
    assert.ok(!html.includes('cloudflareinsights'), rel);
    // Sibling links resolve inside the preview tree; local assets exist in the site root.
    for (const m of html.matchAll(/<a class="sheet" href="([^"]+)"/g)) {
      assert.ok(m[1].startsWith(`/${P.PREVIEW_DIR}/`), m[1]);
      assert.ok(fs.existsSync(path.join(out, m[1], 'index.html')), m[1]);
    }
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]*\.(?:webp|pdf|png|svg))"/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1]);
    }
    assert.ok(/href="\/(en\/printables|de\/ausmalbilder)\/"/.test(html), `${rel} hub link`);
  }
});

test('preview: a build does not touch the published tree', () => {
  const { out } = readPreview({ locales: ['en'], categories: ['animals'] });
  assert.deepEqual(fs.readdirSync(out), [P.PREVIEW_DIR]);
});

test('preview: rejects an unknown locale or category', () => {
  assert.throws(() => P.buildPreview({ root: ROOT, outRoot: tmp(), locales: ['fr'], categories: ['animals'] }), /unknown locale/);
  assert.throws(() => P.buildPreview({ root: ROOT, outRoot: tmp(), locales: ['en'], categories: ['pets'] }), /unknown category/);
});

test('determinism: two preview builds are byte-identical', () => {
  const opts = { locales: ['en', 'de'], categories: P.CATEGORY_ORDER };
  assert.equal(treeHash(readPreview(opts).out), treeHash(readPreview(opts).out));
});

// ---------------------------------------------------------------- page content

test('banned terms are absent from every page and URL (en+de, all 35)', () => {
  const { pages } = ALL_PILOT();
  const banned = [/memory/i, /gedächtnis/i, /completely free/i, /komplett kostenlos/i, /völlig kostenlos/i];
  const sheets = sheetPages(pages);
  assert.equal(sheets.length, 70);
  for (const [rel, html] of Object.entries(pages)) {
    for (const re of banned) {
      assert.ok(!re.test(rel), `${re} in URL ${rel}`);
      assert.ok(!re.test(html), `${re} in ${rel}`);
    }
  }
});

test('RO and ES strings are also free of the local trademark terms', () => {
  const { pages } = readPreview({ locales: ['ro', 'es'], categories: P.CATEGORY_ORDER });
  for (const [rel, html] of Object.entries(pages)) {
    assert.ok(!/memor/i.test(html), rel);
  }
});

test('app name: exact Play title appears and no variant does', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of sheetPages(pages)) {
    const locale = rel.split('/')[1];
    const text = decode(html);
    assert.ok(visibleText(html).includes(APP_TITLES[locale]), `${rel} is missing the title`);
    // Any "Flip & Learn:" must be this locale's title.
    for (const m of text.matchAll(/Flip & Learn: [^.,<"]*/g)) {
      assert.ok(m[0].startsWith(APP_TITLES[locale]), `${rel}: ${m[0]}`);
    }
    assert.ok(!/Flip (&|and) Learn (Words?|ABC|123|app|App|Wort)/.test(text), `${rel} has a variant`);
    assert.ok(!/Flip and Learn/.test(text), `${rel} has a variant`);
  }
});

test('campaign values match the scheme, and URLs otherwise equal the hub', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of sheetPages(pages)) {
    const locale = rel.split('/')[1];
    const row = registry().find((r) => rel.includes(`/${r.locales[locale].slug}/`));
    const campaign = `web-printables-${locale}-${row.category}`;
    const store = (host) => {
      const m = new RegExp(`href="(https://${host}[^"]+)"`).exec(html);
      assert.ok(m, `${rel} no ${host} link`);
      return decode(m[1]);
    };
    const apple = new URL(store('apps.apple.com'));
    assert.equal(apple.searchParams.get('pt'), '128736959', rel);
    assert.equal(apple.searchParams.get('ct'), campaign, rel);
    const play = new URL(store('play.google.com'));
    const ref = new URLSearchParams(play.searchParams.get('referrer'));
    assert.equal(ref.get('utm_source'), 'flipandlearn.app', rel);
    assert.equal(ref.get('utm_medium'), 'web', rel);
    assert.equal(ref.get('utm_campaign'), campaign, rel);

    const hub = fs.readFileSync(path.join(ROOT, P.HUB_PATHS[locale].slice(1), 'index.html'), 'utf8');
    const badges = /<div class="badges"[\s\S]*?<\/div>/.exec(html)[0];
    const hubBadges = /<div class="badges"[\s\S]*?<\/div>/.exec(hub)[0];
    assert.equal(badges.split(campaign).join(`web-printables-${locale}`), hubBadges, `${rel} badge markup`);
  }
});

test('hreflang is reciprocal and points only at generated pages; canonical is self', () => {
  for (const build of [ALL_PILOT(), ALL_LOCALES()]) {
    const sheets = sheetPages(build.pages);
    const byUrl = new Map();
    for (const [rel, html] of sheets) {
      const expected = `https://flipandlearn.app/${rel.replace(`${P.PREVIEW_DIR}/`, '').replace(/index\.html$/, '')}`;
      assert.equal(canonical(html), expected, rel);
      byUrl.set(expected, html);
    }
    for (const [url, html] of byUrl) {
      const links = hreflangs(html);
      assert.ok(links.some((l) => l.href === url), `${url} has no self hreflang`);
      const xd = links.find((l) => l.lang === 'x-default');
      const en = links.find((l) => l.lang === 'en');
      assert.equal(xd.href, en.href, url);
      for (const l of links) {
        assert.ok(byUrl.has(l.href), `${url} points at ungenerated ${l.href}`);
        assert.ok(hreflangs(byUrl.get(l.href)).some((b) => b.href === url), `${l.href} does not point back at ${url}`);
      }
    }
  }
});

test('pilot hreflang references en and de only', () => {
  const { pages } = ALL_PILOT();
  for (const [rel, html] of sheetPages(pages)) {
    assert.deepEqual(hreflangs(html).map((l) => l.lang), ['en', 'de', 'x-default'], rel);
  }
});

test('JSON-LD parses, with the breadcrumb and LearningResource the brief asks for', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of sheetPages(pages)) {
    const blocks = jsonLd(html);
    assert.equal(blocks.length, 1, rel);
    const graph = blocks[0]['@graph'];
    const crumbs = graph.find((g) => g['@type'] === 'BreadcrumbList');
    const res = graph.find((g) => g['@type'] === 'LearningResource');
    assert.deepEqual(crumbs.itemListElement.map((c) => c.position), [1, 2, 3], rel);
    assert.equal(crumbs.itemListElement[2].item, canonical(html), rel);
    assert.equal(res.typicalAgeRange, '4-7', rel);
    assert.equal(res.inLanguage, rel.split('/')[1], rel);
    assert.equal(res.encoding.encodingFormat, 'application/pdf', rel);
    for (const u of [res.encoding.contentUrl, res.image]) {
      assert.ok(fs.existsSync(path.join(ROOT, new URL(u).pathname)), `${rel}: ${u}`);
    }
  }
});

test('title and H1 follow the brief for the sample sheets', () => {
  const { pages } = ALL_PILOT();
  const get = (p) => pages[`${P.PREVIEW_DIR}/${p}/index.html`];
  const cat = get('en/printables/cat-coloring-page');
  assert.ok(cat.includes('<title>Cat Coloring Page and Letter Tracing Worksheet (PDF) | Flip &amp; Learn</title>'));
  assert.ok(cat.includes('<h1>Cat coloring page with letter tracing</h1>'));
  const katze = get('de/ausmalbilder/katze-ausmalbild');
  assert.ok(katze.includes('<title>Katze Ausmalbild mit Schreibübung (PDF) | Flip &amp; Learn</title>'));
  assert.ok(katze.includes('<h1>Katze: Ausmalbild mit Schreibübung</h1>'));
  assert.ok(get('de/ausmalbilder/kuerbis-ausmalbild').includes('<h1>Kürbis: Ausmalbild mit Schreibübung</h1>'));
  assert.ok(get('en/printables/three-coloring-page').includes('<h1>Number Three coloring page with letter tracing</h1>'));
});

test('every img has width and height, and sized content images get height:auto', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of Object.entries(pages)) {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1].replace(/\s+/g, '');
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const tag = m[0];
      assert.match(tag, /\bwidth="\d+"/, `${rel}: ${tag}`);
      assert.match(tag, /\bheight="\d+"/, `${rel}: ${tag}`);
      if (tag.includes('class="nav-icon"')) continue; // Fixed 32x32 square in CSS, ratio kept.
      if (/style="height:\d+px;width:auto/.test(tag)) continue; // Hub badges: fixed height, width:auto.
      if (tag.includes('class="sheet-preview-img"')) {
        assert.match(css, /\.sheet-preview-img\{[^}]*max-width:[^}]*height:auto/, rel);
      } else if (rel === `${P.PREVIEW_DIR}/index.html`) {
        assert.match(css, /\.gridimg\{[^}]*height:auto/, rel);
      } else {
        assert.match(html.slice(Math.max(0, m.index - 120), m.index), /<a class="sheet"/, `${rel}: ${tag}`);
        assert.match(css, /\.sheetimg\{[^}]*height:auto/, rel);
      }
    }
  }
});

test('visible website URLs are written www.flipandlearn.app', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of Object.entries(pages)) {
    for (const m of visibleText(html).matchAll(/(\S*)flipandlearn\.app/g)) {
      assert.ok(m[1] === 'www.' || m[1] === 'support@', `${rel}: ${m[0]}`);
    }
  }
});

test('pages carry the hub chrome: consent gate and store_click', () => {
  const { pages } = ALL_LOCALES();
  for (const [rel, html] of sheetPages(pages)) {
    for (const needle of ['__flLoadGtag', 'id="ccBanner"', "'store_click'", 'id="cookiePrefs"']) {
      assert.ok(html.includes(needle), `${rel}: ${needle}`);
    }
  }
});

test('all S locales have the same keys, and appName is the Play title', () => {
  const keys = Object.keys(S.en).sort();
  for (const locale of P.LOCALE_ORDER) {
    assert.deepEqual(Object.keys(S[locale]).sort(), keys, locale);
    assert.equal(S[locale].appName, APP_TITLES[locale], locale);
    for (const k of keys) assert.ok(S[locale][k], `${locale}.${k}`);
  }
});

// ---------------------------------------------------------------- pilot copy

function pilotCopies() {
  const out = [];
  for (const row of registry()) {
    if (!PILOT_CATEGORIES.includes(row.category)) continue;
    for (const locale of PILOT_LOCALES) {
      const c = row.locales[locale].copy;
      out.push({ row, locale, copy: c, text: [c.intro, c.tracingTips, ...c.activityIdeas].join(' ') });
    }
  }
  return out;
}

test('pilot copy: 30 pages within 100 to 220 words, with 2 or 3 ideas each', () => {
  const copies = pilotCopies();
  assert.equal(copies.length, 30);
  for (const { row, locale, copy, text } of copies) {
    const n = P.copyWordCount(copy);
    assert.equal(n, text.trim().split(/\s+/).length);
    assert.ok(n >= 100 && n <= 220, `${row.id} ${locale}: ${n} words`);
    assert.ok(copy.activityIdeas.length >= 2 && copy.activityIdeas.length <= 3, `${row.id} ${locale}`);
  }
});

test('pilot copy: names both of the sheet\'s own words as whole words', () => {
  for (const { row, locale, text } of pilotCopies()) {
    for (const word of row.locales[locale].words) {
      const re = new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'iu');
      assert.match(text, re, `${row.id} ${locale}: ${word}`);
    }
  }
});

test('pilot copy: near-duplicate guard, word 3-gram Jaccard below 0.35 in each locale', () => {
  const grams = (text) => {
    const w = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu);
    const s = new Set();
    for (let i = 0; i + 2 < w.length; i++) s.add(w.slice(i, i + 3).join(' '));
    return s;
  };
  for (const locale of PILOT_LOCALES) {
    const items = pilotCopies().filter((c) => c.locale === locale).map((c) => ({ id: c.row.id, g: grams(c.text) }));
    assert.equal(items.length, 15);
    let top = { v: 0 };
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const shared = [...items[i].g].filter((x) => items[j].g.has(x)).length;
        const v = shared / (items[i].g.size + items[j].g.size - shared);
        if (v > top.v) top = { v, a: items[i].id, b: items[j].id };
        assert.ok(v < 0.35, `${locale} ${items[i].id} vs ${items[j].id}: ${v}`);
      }
    }
    console.log(`highest 3-gram Jaccard ${locale}: ${top.v.toFixed(4)} (${top.a} vs ${top.b})`);
  }
});

test('pilot copy: no banned terms, efficacy claims or emoji; app named at most once', () => {
  const banned = [/memory/i, /gedächtnis/i, /completely free/i, /komplett kostenlos/i, /völlig kostenlos/i, /will learn/i, /wird lernen/i, /lernt schnell/i, /master/i, /guarantee/i, /garantiert/i, /improve/i, /verbesser/i, /beherrsch/i, /\p{Extended_Pictographic}/u];
  for (const { row, locale, text } of pilotCopies()) {
    for (const re of banned) assert.ok(!re.test(text), `${row.id} ${locale}: ${re}`);
    assert.ok(text.split('Flip & Learn').length - 1 <= 1, `${row.id} ${locale}: app named more than once`);
    if (text.includes('Flip & Learn')) assert.ok(text.includes(APP_TITLES[locale]), `${row.id} ${locale}`);
  }
});

test('pilot copy: German register is Sie, with no du forms', () => {
  const du = /(?<!\p{L})(du|dein|deine|deinem|deinen|deiner|dir|dich)(?!\p{L})/iu;
  for (const { row, locale, text } of pilotCopies()) {
    if (locale === 'de') assert.ok(!du.test(text), `${row.id}: ${du.exec(text)}`);
  }
});

test('copy review lists all 30 pilot copies grouped by sheet, EN and DE side by side', () => {
  const md = P.renderCopyReview(registry(), { locales: PILOT_LOCALES, categories: PILOT_CATEGORIES });
  assert.equal((md.match(/^## /gm) || []).length, 15);
  assert.equal((md.match(/^\| \| EN \(\d+ words\) \| DE \(\d+ words\) \|$/gm) || []).length, 15);
  for (const { copy } of pilotCopies()) assert.ok(md.includes(copy.intro));
});

test('pilot copy: no German-style respellings of English words on DE pages', () => {
  const words = 'faiw|äit|nain|wann|tu|tri|for|siks|sewen|tän|dack';
  const re = new RegExp('(?:„|klingt[^.]{0,40}?\\s|ausgesprochen[^.]{0,40}?\\s|wie\\s+)(?:' + words + ')(?!\\p{L})', 'iu');
  for (const { row, locale, text } of pilotCopies()) {
    if (locale === 'de') assert.ok(!re.test(text), row.id + ': ' + re.exec(text));
  }
});

test('pilot copy: no quoted respellings of German words on EN pages', () => {
  const hyphenated = /\p{L}+-\p{L}+/u; // Checked inside each quoted pair, so "High-five" outside quotes is fine.
  const known = /"(hoont|shvine|ines|tsvy|tsayn|dry|feer|zeks|noyn)"/i;
  for (const { row, locale, text } of pilotCopies()) {
    if (locale !== 'en') continue;
    for (const [quoted] of text.matchAll(/"[^"]*"/g)) assert.ok(!hyphenated.test(quoted), row.id + ': ' + quoted);
    assert.ok(!known.test(text), row.id + ': ' + known.exec(text));
  }
});

test('pilot copy: no unsourced generalisations about children', () => {
  const re = /viele kinder|vielen kindern|kinder lieben|die meisten kinder|most kids|most children|many kids|many children|children love|kids love/i;
  for (const { row, locale, text } of pilotCopies()) assert.ok(!re.test(text), row.id + ' ' + locale + ': ' + re.exec(text));
});

// ---------------------------------------------------------------- live pilot

const SITE = 'https://flipandlearn.app';
const SHEET_URL = /-(coloring-page|ausmalbild|fisa-de-colorat|ficha-para-colorear)\/$/;
const pagePath = (locale, entry) => P.HUB_PATHS[locale] + entry.slug + '/';
const readRoot = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readHub = (locale) => readRoot(P.HUB_PATHS[locale].slice(1) + 'index.html');
function publishedPages() {
  const out = [];
  for (const row of registry()) {
    for (const locale of P.LOCALE_ORDER) {
      if (row.locales[locale].published) out.push({ row, locale, entry: row.locales[locale], path: pagePath(locale, row.locales[locale]) });
    }
  }
  return out;
}

test('live pages: one at the real path for every published page, and no orphans', () => {
  const published = publishedPages().map((p) => p.path).sort();
  assert.equal(published.length, 30);
  const found = [];
  for (const locale of P.LOCALE_ORDER) {
    const hubDir = path.join(ROOT, P.HUB_PATHS[locale]);
    for (const name of fs.readdirSync(hubDir, { withFileTypes: true })) {
      if (name.isDirectory()) found.push(P.HUB_PATHS[locale] + name.name + '/');
    }
  }
  assert.deepEqual(found.sort(), published);
  for (const p of published) assert.ok(fs.existsSync(path.join(ROOT, p, 'index.html')), p);
});

test('live pages: indexable, with beacon, consent, hreflang, self canonical and real links', () => {
  for (const { row, locale, entry, path: p } of publishedPages()) {
    const html = readRoot(p.slice(1) + 'index.html');
    assert.match(html, /<meta name="robots" content="index,follow">/, p);
    assert.ok(html.includes('cloudflareinsights'), p + ' beacon');
    assert.ok(html.includes('__flLoadGtag') && html.includes("'store_click'"), p + ' consent');
    assert.ok(!html.includes('COPY PENDING') && !html.includes('PREVIEW'), p);
    assert.ok(!html.includes(P.PREVIEW_DIR), p + ' preview path');
    assert.equal(canonical(html), SITE + p);
    assert.deepEqual(hreflangs(html), [
      { lang: 'en', href: SITE + pagePath('en', row.locales.en) },
      { lang: 'de', href: SITE + pagePath('de', row.locales.de) },
      { lang: 'x-default', href: SITE + pagePath('en', row.locales.en) },
    ], p);
    assert.ok(html.includes('href="' + entry.pdf + '"'), p + ' pdf');
    for (const m of html.matchAll(/<a class="sheet" href="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, m[1], 'index.html')), p + ' sibling ' + m[1]);
    }
    assert.equal((html.match(/<a class="sheet" href=/g) || []).length, COUNTS[row.category] - 1, p);
  }
});

test('sitemap: exactly the 30 sheet URLs, with reciprocal alternates and x-default', () => {
  const blocks = readRoot('sitemap.xml').match(/<url>[\s\S]*?<\/url>/g);
  const sheets = new Map();
  for (const b of blocks) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(b)[1];
    if (SHEET_URL.test(loc)) sheets.set(loc, b);
  }
  const pages = publishedPages();
  assert.deepEqual([...sheets.keys()].sort(), pages.map((p) => SITE + p.path).sort());
  const alternates = (b) => [...b.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  for (const { row, path: p } of pages) {
    const b = sheets.get(SITE + p);
    assert.match(b, /<changefreq>monthly<\/changefreq>\s*<priority>0\.6<\/priority>/, p);
    const en = SITE + pagePath('en', row.locales.en);
    const de = SITE + pagePath('de', row.locales.de);
    assert.deepEqual(alternates(b), [['en', en], ['de', de], ['x-default', en]], p);
  }
  for (const row of registry()) {
    for (const locale of P.LOCALE_ORDER) {
      if (!row.locales[locale].published) assert.ok(!sheets.has(SITE + pagePath(locale, row.locales[locale])), row.id + ' ' + locale);
    }
  }
});

test('hubs: pilot cards link to existing sheet pages and keep the PDF download', () => {
  for (const locale of ['en', 'de']) {
    const html = readHub(locale);
    for (const row of registry()) {
      const e = row.locales[locale];
      if (e.published) {
        const card = new RegExp('<div class="sheet">\\s*<a class="sheet-link" href="' + pagePath(locale, e) + '">\\s*<img src="' + e.thumb + '"[^>]*>\\s*<span class="sheet-word">[^<]*</span>\\s*</a>\\s*<span class="sheet-meta">[^<]*</span>\\s*<a class="sheet-dl" href="' + e.pdf + '" download type="application/pdf"');
        assert.match(html, card, row.id + ' ' + locale);
        assert.ok(fs.existsSync(path.join(ROOT, pagePath(locale, e), 'index.html')), row.id);
      } else {
        assert.match(html, new RegExp('<a class="sheet" href="' + e.pdf + '" download type="application/pdf">'), row.id + ' ' + locale);
      }
    }
    assert.ok(!/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/.test(html.slice(html.indexOf('<main>'), html.indexOf('</main>'))), locale + ': nested links');
  }
});

test('hubs: ItemList uses sheet URLs for the pilot, PDFs for the other 20, and the count matches', () => {
  for (const locale of ['en', 'de']) {
    const list = jsonLd(readHub(locale))[0].mainEntity;
    assert.equal(list.numberOfItems, 35);
    assert.equal(list.itemListElement.length, 35);
    const urls = list.itemListElement.map((i) => i.url);
    for (const row of registry()) {
      const e = row.locales[locale];
      assert.ok(urls.includes(SITE + (isPilot(row, locale) ? pagePath(locale, e) : e.pdf)), row.id + ' ' + locale);
    }
    assert.equal(urls.filter((u) => u.endsWith('.pdf')).length, 20, locale);
    assert.equal(urls.filter((u) => SHEET_URL.test(u)).length, 15, locale);
    for (const u of urls.filter((v) => SHEET_URL.test(v))) {
      assert.ok(fs.existsSync(path.join(ROOT, new URL(u).pathname, 'index.html')), u);
    }
  }
});

test('RO and ES hubs have no sheet links and keep all 35 PDF URLs', () => {
  for (const locale of ['ro', 'es']) {
    const html = readHub(locale);
    assert.ok(!html.includes('class="sheet-link"'), locale);
    const list = jsonLd(html)[0].mainEntity;
    assert.equal(list.numberOfItems, list.itemListElement.length, locale);
    assert.ok(list.itemListElement.every((i) => i.url.endsWith('.pdf')), locale);
  }
});

test('CI workflow runs the build, the drift comparison and these tests', () => {
  const yml = readRoot('.github/workflows/build-drift.yml');
  const order = ['node build-locales.js', 'git diff --quiet', 'node --test tests/printables.test.js'].map((c) => yml.indexOf(c));
  assert.ok(order.every((n) => n >= 0), order.join());
  assert.ok(order[0] < order[1] && order[1] < order[2], order.join());
});

// ---------------------------------------------------------------- drift

test('drift: node build-locales.js leaves git diff and status byte-identical', () => {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const before = git('diff') + git('status', '--porcelain');
  execFileSync(process.execPath, ['build-locales.js'], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(git('diff') + git('status', '--porcelain'), before);
});
