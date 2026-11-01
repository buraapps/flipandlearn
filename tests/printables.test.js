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
      const re = new RegExp(`href="${e.pdf}"[^>]*>\\s*<img[^>]*>\\s*<span class="sheet-word">([^<]*)</span>`);
      const m = re.exec(html);
      assert.ok(m, `${e.pdf} not on the ${locale} hub`);
      assert.equal(m[1], e.words.join(' / '), `${row.id} ${locale}`);
    }
  }
});

test('registry: nothing is published and every copy slot is empty this session', () => {
  for (const row of registry()) {
    for (const locale of P.LOCALE_ORDER) {
      assert.equal(row.locales[locale].published, false, `${row.id} ${locale}`);
      assert.equal(row.locales[locale].copy, '', `${row.id} ${locale}`);
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

function withPublished(id, locale, copy) {
  const rows = registry();
  const e = rows.find((r) => r.id === id).locales[locale];
  e.published = true;
  e.copy = copy;
  return rows;
}

test('published build refuses a page with empty copy and writes nothing', () => {
  for (const copy of ['', '   \n ']) {
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
  const written = P.buildPublished({ root: ROOT, outRoot: out, registry: withPublished('animals-01', 'en', 'First paragraph.\n\nSecond paragraph.') });
  assert.deepEqual(written, ['en/printables/cat-coloring-page/index.html']);
  const html = fs.readFileSync(path.join(out, written[0]), 'utf8');
  assert.match(html, /<meta name="robots" content="index,follow">/);
  assert.ok(html.includes('<p>First paragraph.</p>') && html.includes('<p>Second paragraph.</p>'));
  assert.ok(!html.includes('COPY PENDING') && !html.includes('PREVIEW'));
  assert.ok(html.includes('cloudflareinsights'), 'published pages keep the hub analytics tag');
  // Nothing else is published: no hreflang or link to an unbuilt page.
  assert.deepEqual(hreflangs(html).map((h) => h.lang), ['en', 'x-default']);
  assert.ok(!html.includes('dog-coloring-page'));
});

test('zero published rows: normal build writes nothing, sitemap hook is empty', () => {
  const out = tmp();
  assert.deepEqual(P.buildPublished({ root: ROOT, outRoot: out }), []);
  assert.deepEqual(fs.readdirSync(out), []);
  assert.deepEqual(P.printableSheetSitemapEntries(registry()), []);
});

test('sitemap: no sheet URL is registered yet', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  assert.ok(!/-(coloring-page|ausmalbild|fisa-de-colorat|ficha-para-colorear)\//.test(sitemap));
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

test('preview: noindex, visible COPY PENDING, no analytics beacon, links stay real', () => {
  const { pages, out } = readPreview({ locales: ['en', 'de'], categories: ['animals', 'numbers'] });
  for (const [rel, html] of sheetPages(pages)) {
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/, rel);
    assert.ok(visibleText(html).includes('COPY PENDING'), rel);
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

// ---------------------------------------------------------------- drift

test('drift: node build-locales.js leaves git diff and status byte-identical', () => {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const before = git('diff') + git('status', '--porcelain');
  execFileSync(process.execPath, ['build-locales.js'], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(git('diff') + git('status', '--porcelain'), before);
});
