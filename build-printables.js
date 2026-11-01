#!/usr/bin/env node
/**
 * build-printables.js: one HTML page per printable sheet per locale. Node built-ins only.
 *
 *   node build-printables.js
 *     Normal mode. Writes pages only for sheets with published:true in
 *     printables/sheets.json. build-locales.js calls this too, so published pages fall
 *     under the drift check. Refuses to build a published page whose copy slot is empty.
 *
 *   node build-printables.js --preview --locales=en,de --categories=animals,numbers
 *     Writes the chosen pages under _preview/ (noindex,nofollow) with a contact sheet at
 *     _preview/index.html. _preview/ is wiped first and is excluded from git locally.
 *     Serve with `python3 -m http.server` from this folder.
 *
 * The hubs are the source of the shared chrome: head links, stylesheet, consent script,
 * nav, footer, cookie banner, store badges. They are read at build time, so a fix to a hub
 * reaches its sheet pages on the next build. If a hub's markup stops matching, the build
 * stops rather than emitting a page with a part missing.
 */
const fs = require('fs');
const path = require('path');
const { S } = require('./printables-strings.js');

const ROOT = __dirname;
const SITE = 'https://flipandlearn.app';
const REGISTRY_PATH = path.join('printables', 'sheets.json');
const PREVIEW_DIR = '_preview';
const LOCALE_ORDER = ['en', 'de', 'ro', 'es'];
const CATEGORY_ORDER = ['animals', 'fruits', 'vegetables', 'nature', 'numbers', 'halloween'];
// Keep in sync with PRINTABLES_PATHS in build-locales.js (checked by the tests).
const HUB_PATHS = { en: '/en/printables/', de: '/de/ausmalbilder/', ro: '/ro/fise-de-colorat/', es: '/es/fichas-para-colorear/' };
const SLUG_SUFFIX = { en: 'coloring-page', de: 'ausmalbild', ro: 'fisa-de-colorat', es: 'ficha-para-colorear' };
const THUMB_W = 600;
const THUMB_H = 849;

const SHEET_CSS = `
/* Sheet page */
.crumb{padding:20px 0 0;font-size:14.5px}
.sheet-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;align-items:start;padding:20px 0 8px}
.sheet-top h1{font-size:38px;font-weight:700;letter-spacing:-0.5px;margin-bottom:16px;line-height:1.15}
.sheet-top .sub{font-size:18px;color:#3c3c43;margin-bottom:12px;line-height:1.55}
.sheet-preview-img{display:block;width:100%;max-width:440px;height:auto;margin:0 auto;border-radius:10px;border:1px solid #e0e0e0;background:#fff}
.dl-btn{display:inline-block;background:#3A3589;color:#fff;font-size:17px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:12px;margin-top:10px}
.dl-btn:hover{background:#5E5CE6;color:#fff}
.dl-meta{display:block;font-size:13.5px;color:#6e6e73;margin-top:8px}
.copy-pending{background:#fff3cd;border:2px dashed #b58900;border-radius:10px;padding:18px;font-weight:700;color:#6b5200}
@media(max-width:900px){.sheet-top{grid-template-columns:minmax(0,1fr);gap:28px}.sheet-top h1{font-size:30px}}
`;

const PREVIEW_BANNER = 'position:sticky;top:0;z-index:200;background:#b58900;color:#fff;font:600 14px/1.4 -apple-system,Arial,sans-serif;padding:8px 16px;text-align:center';

// ---------------------------------------------------------------- helpers

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!(key in values)) throw new Error(`printables: no value for {${key}} in "${template}"`);
    return values[key];
  });
}

// ä→ae ö→oe ü→ue ß→ss, every other accent dropped, anything else non-alphanumeric → "-".
function transliterate(word) {
  return word
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function slugFor(locale, word) {
  return `${transliterate(word)}-${SLUG_SUFFIX[locale]}`;
}

function pagePath(locale, entry) {
  return `${HUB_PATHS[locale]}${entry.slug}/`;
}

function loadRegistry(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, REGISTRY_PATH), 'utf8'));
}

function hasCopy(entry) {
  return typeof entry.copy === 'string' && entry.copy.trim() !== '';
}

function cut(html, re, what, locale) {
  const m = re.exec(html);
  if (!m) throw new Error(`printables: cannot find ${what} in the ${locale} hub`);
  return m[1];
}

function readHubChrome(locale, root = ROOT) {
  const html = fs.readFileSync(path.join(root, HUB_PATHS[locale].slice(1), 'index.html'), 'utf8');
  const home = /<div class="flinks">\s*<a href="([^"]+)">([^<]+)<\/a>/.exec(html);
  if (!home) throw new Error(`printables: cannot find the home link in the ${locale} hub`);
  const hubCampaign = `web-printables-${locale}`;
  const badges = cut(html, /(<div class="badges"[\s\S]*?<\/div>)/, 'store badges', locale);
  const campaignCount = badges.split(hubCampaign).length - 1;
  if (campaignCount !== 2) throw new Error(`printables: expected 2 campaign values in the ${locale} hub badges, found ${campaignCount}`);
  return {
    headLinks: cut(html, /(<meta name="theme-color"[\s\S]*?)\n*<link rel="canonical"/, 'head links', locale),
    consent: cut(html, /(<!-- FLI-cookie-consent: Google Ads tag[\s\S]*?<\/script>)/, 'consent script', locale),
    css: cut(html, /<style>([\s\S]*?)<\/style>/, 'stylesheet', locale),
    nav: cut(html, /(<nav>[\s\S]*?<\/nav>)/, 'nav', locale),
    tail: cut(html, /(<footer>[\s\S]*)<\/body>/, 'footer', locale),
    support: cut(html, /(<p class="support">[\s\S]*?<\/p>)/, 'support line', locale),
    badges,
    hubCampaign,
    homeHref: home[1],
    homeLabel: home[2],
  };
}

// ---------------------------------------------------------------- planning

// Which pages exist in this build. Anything a page links to must be in this list.
function planPages(registry, { mode, locales = LOCALE_ORDER, categories = CATEGORY_ORDER }) {
  const pages = [];
  for (const row of registry) {
    for (const locale of LOCALE_ORDER) {
      const entry = row.locales[locale];
      if (mode === 'published') {
        if (!entry.published) continue;
        if (!hasCopy(entry)) {
          throw new Error(`printables: ${row.id}/${locale} is published but its copy slot is empty. Refusing to build.`);
        }
      } else if (!locales.includes(locale) || !categories.includes(row.category)) {
        continue;
      }
      pages.push({ row, locale, entry, path: pagePath(locale, entry) });
    }
  }
  return pages;
}

// ---------------------------------------------------------------- page

function wordsFor(row, locale) {
  const str = S[locale];
  const [word, second] = row.locales[locale].words;
  const upper = (w) => w.toLocaleUpperCase(locale);
  return {
    word,
    subject: row.category === 'numbers' ? `${str.numberPrefix} ${word}` : word,
    A: upper(word),
    B: upper(second),
    app: str.appName,
    category: str.categories[row.category],
  };
}

function renderCopy(entry, str, preview) {
  if (hasCopy(entry)) {
    return entry.copy.trim().split(/\n\s*\n/).map((p) => `    <p>${esc(p.trim())}</p>`).join('\n');
  }
  if (!preview) throw new Error('printables: refusing to render a published page with empty copy');
  return '    <p class="copy-pending">COPY PENDING: per-sheet copy is written in Session 4.</p>';
}

function renderJsonLd(page, str, chrome, values) {
  const { row, entry, locale } = page;
  const url = `${SITE}${page.path}`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: chrome.homeLabel, item: `${SITE}${chrome.homeHref}` },
          { '@type': 'ListItem', position: 2, name: str.breadcrumbHub, item: `${SITE}${HUB_PATHS[locale]}` },
          { '@type': 'ListItem', position: 3, name: fill(str.resourceName, values), item: url },
        ],
      },
      {
        '@type': 'LearningResource',
        name: fill(str.resourceName, values),
        description: fill(str.description, values),
        url,
        inLanguage: locale,
        isFamilyFriendly: true,
        isAccessibleForFree: true,
        learningResourceType: 'Worksheet',
        typicalAgeRange: '4-7',
        about: str.categories[row.category],
        image: `${SITE}${entry.thumb}`,
        encoding: { '@type': 'MediaObject', contentUrl: `${SITE}${entry.pdf}`, encodingFormat: 'application/pdf' },
        publisher: { '@type': 'Organization', name: 'BuraApps', url: SITE },
      },
    ],
  };
  return JSON.stringify(graph, null, 2).replace(/</g, '\\u003c');
}

function renderPage(page, ctx) {
  const { row, entry, locale } = page;
  const { preview, siblingsOf, alternatesOf, chromeOf, link } = ctx;
  const str = S[locale];
  const chrome = chromeOf(locale);
  const v = wordsFor(row, locale);
  const title = fill(str.title, v);
  const description = fill(str.description, v);
  const alt = fill(str.alt, v);
  const url = `${SITE}${page.path}`;
  const image = `${SITE}${entry.thumb}`;

  const alternates = alternatesOf(row);
  const hreflang = alternates
    .map((p) => `<link rel="alternate" hreflang="${p.locale}" href="${SITE}${p.path}">`)
    .concat(alternates.some((p) => p.locale === 'en')
      ? [`<link rel="alternate" hreflang="x-default" href="${SITE}${alternates.find((p) => p.locale === 'en').path}">`]
      : [])
    .join('\n');
  const ogAlternates = alternates
    .filter((p) => p.locale !== locale)
    .map((p) => `<meta property="og:locale:alternate" content="${S[p.locale].ogLocale}">`)
    .join('\n');

  const campaign = `${chrome.hubCampaign}-${row.category}`;
  const badges = chrome.badges.split(chrome.hubCampaign).join(campaign);

  const siblings = siblingsOf(page);
  const siblingCards = siblings.map((p) => {
    const sv = wordsFor(p.row, locale);
    return `      <a class="sheet" href="${link(p.path)}">
        <img src="${esc(p.entry.thumb)}" alt="${esc(fill(str.alt, sv))}" width="${THUMB_W}" height="${THUMB_H}" loading="lazy" decoding="async">
        <span class="sheet-word">${esc(sv.word)}</span>
      </a>`;
  }).join('\n');
  const siblingSection = siblings.length === 0 ? '' : `
  <section aria-labelledby="more-h2">
    <h2 id="more-h2">${esc(fill(str.moreHeading, v))}</h2>
    <div class="sheets">
${siblingCards}
    </div>
  </section>
`;

  // Local previews must not count as site traffic. Published pages keep the hub's tail as is.
  const tail = preview
    ? chrome.tail.replace(/<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->\n?/, '')
    : chrome.tail;
  const banner = preview ? `<div style="${PREVIEW_BANNER}">PREVIEW: not published, noindex</div>\n` : '';

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${chrome.headLinks}

<link rel="canonical" href="${url}">
${hreflang}

<meta property="og:type" content="website">
<meta property="og:site_name" content="Flip &amp; Learn">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="${THUMB_W}">
<meta property="og:image:height" content="${THUMB_H}">
<meta property="og:image:alt" content="${esc(alt)}">
<meta property="og:locale" content="${str.ogLocale}">
${ogAlternates ? `${ogAlternates}\n` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">

<meta name="robots" content="${preview ? 'noindex,nofollow' : 'index,follow'}">

<script type="application/ld+json">
${renderJsonLd(page, str, chrome, v)}
</script>

${chrome.consent}

<style>${chrome.css}${SHEET_CSS}</style>
</head>
<body>
${banner}${chrome.nav}

<main>
  <p class="crumb"><a href="${HUB_PATHS[locale]}">&larr; ${esc(str.backToHub)}</a></p>

  <div class="sheet-top">
    <div>
      <h1>${esc(fill(str.h1, v))}</h1>
      <p class="sub">${esc(str.subIntro)}</p>
      <p class="sub">${esc(fill(str.subDetail, v))}</p>
      <a class="dl-btn" href="${esc(entry.pdf)}" download type="application/pdf">&darr; ${esc(str.download)}</a>
      <span class="dl-meta">${esc(str.downloadMeta)}</span>
    </div>
    <div>
      <img class="sheet-preview-img" src="${esc(entry.thumb)}" alt="${esc(alt)}" width="${THUMB_W}" height="${THUMB_H}" fetchpriority="high" decoding="async">
    </div>
  </div>

  <section class="prose" aria-labelledby="copy-h2">
    <h2 id="copy-h2">${esc(str.copyHeading)}</h2>
${renderCopy(entry, str, preview)}
  </section>

  <section class="prose" aria-labelledby="print-h2">
    <h2 id="print-h2">${esc(str.printHeading)}</h2>
    <p>${esc(str.printText)}</p>
  </section>
${siblingSection}
  <section class="final-cta" aria-labelledby="cta-h2">
    <h2 id="cta-h2">${esc(str.ctaHeading)}</h2>
    <p>${esc(fill(str.ctaText, v))}</p>
    ${badges}
    ${chrome.support}
  </section>
</main>

${tail}</body>
</html>
`;
}

// ---------------------------------------------------------------- rendering

// Returns [[relative output path, html], ...] in registry order.
function renderAll(pages, { preview, root }) {
  const generated = new Set(pages.map((p) => p.path));
  const chromes = new Map();
  const ctx = {
    preview,
    chromeOf(locale) {
      if (!chromes.has(locale)) chromes.set(locale, readHubChrome(locale, root));
      return chromes.get(locale);
    },
    alternatesOf: (row) => pages.filter((p) => p.row.id === row.id),
    siblingsOf: (page) => pages.filter((p) => p.locale === page.locale && p.row.category === page.row.category && p.row.id !== page.row.id),
    link: (p) => {
      if (!generated.has(p)) throw new Error(`printables: link to a page that is not generated: ${p}`);
      return preview ? `/${PREVIEW_DIR}${p}` : p;
    },
  };
  return pages.map((page) => {
    const rel = `${preview ? `${PREVIEW_DIR}/` : ''}${page.path.slice(1)}index.html`;
    return [rel, renderPage(page, ctx)];
  });
}

function renderContactSheet(pages) {
  const groups = [];
  for (const locale of LOCALE_ORDER) {
    for (const category of CATEGORY_ORDER) {
      const cards = pages
        .filter((p) => p.locale === locale && p.row.category === category)
        .map((p) => `    <a href="/${PREVIEW_DIR}${p.path}"><img src="${esc(p.entry.thumb)}" alt="${esc(fill(S[locale].alt, wordsFor(p.row, locale)))}" width="${THUMB_W}" height="${THUMB_H}" loading="lazy"><span>${esc(p.entry.words[0])}</span></a>`);
      if (cards.length > 0) {
        groups.push(`  <h2>${locale.toUpperCase()}: ${esc(S[locale].categories[category])} (${cards.length})</h2>\n  <div class="grid">\n${cards.join('\n')}\n  </div>`);
      }
    }
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Printables preview</title>
<style>
body{font-family:-apple-system,Arial,sans-serif;background:#f5f5f7;color:#1d1d1f;margin:0 auto;max-width:1080px;padding:16px}
h1{font-size:26px}h2{font-size:18px;margin:28px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
.grid a{display:block;background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:8px;text-decoration:none;color:inherit;font-size:14px;font-weight:600}
.grid img{display:block;width:100%;height:auto;margin-bottom:6px}
</style>
</head>
<body>
  <h1>Printables preview: ${pages.length} pages</h1>
  <p>Not published. Every page is noindex,nofollow.</p>
${groups.join('\n')}
</body>
</html>
`;
}

// ---------------------------------------------------------------- build entry points

function writeAll(files, outRoot) {
  for (const [rel, html] of files) {
    const out = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, 'utf8');
  }
}

// Normal mode. With nothing published this writes nothing. Pages that were published and
// later set back to false are not deleted here: remove them in the same commit.
function buildPublished({ root = ROOT, outRoot = root, registry = loadRegistry(root) } = {}) {
  const files = renderAll(planPages(registry, { mode: 'published' }), { preview: false, root });
  writeAll(files, outRoot);
  return files.map(([rel]) => rel);
}

function buildPreview({ root = ROOT, outRoot = root, registry = loadRegistry(root), locales, categories }) {
  for (const l of locales) if (!LOCALE_ORDER.includes(l)) throw new Error(`printables: unknown locale "${l}"`);
  for (const c of categories) if (!CATEGORY_ORDER.includes(c)) throw new Error(`printables: unknown category "${c}"`);
  const pages = planPages(registry, { mode: 'preview', locales, categories });
  const files = renderAll(pages, { preview: true, root });
  files.push([`${PREVIEW_DIR}/index.html`, renderContactSheet(pages)]);
  fs.rmSync(path.join(outRoot, PREVIEW_DIR), { recursive: true, force: true });
  writeAll(files, outRoot);
  return files.map(([rel]) => rel);
}

// Sitemap hook, deliberately unused until Session 5. buildSitemap() in build-locales.js is
// meant to call this and emit one <url> per entry, each with its own alternates. Until then
// no sheet URL may enter the sitemap.
function printableSheetSitemapEntries(registry = loadRegistry()) {
  const pages = planPages(registry, { mode: 'published' });
  return pages.map((p) => ({
    loc: `${SITE}${p.path}`,
    alternates: pages.filter((a) => a.row.id === p.row.id).map((a) => ({ hreflang: a.locale, href: `${SITE}${a.path}` })),
  }));
}

function parseListArg(argv, name) {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

function main(argv) {
  const known = /^--(preview$|locales=|categories=)/;
  for (const a of argv) if (!known.test(a)) throw new Error(`Unknown argument "${a}"`);
  const preview = argv.includes('--preview');
  const locales = parseListArg(argv, 'locales');
  const categories = parseListArg(argv, 'categories');
  if (!preview) {
    if (locales || categories) throw new Error('--locales and --categories need --preview');
    console.log(`printables: wrote ${buildPublished().length} published page(s)`);
    return;
  }
  const written = buildPreview({ locales: locales || LOCALE_ORDER, categories: categories || CATEGORY_ORDER });
  console.log(`printables: wrote ${written.length - 1} preview page(s) plus the contact sheet under ${PREVIEW_DIR}/`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  HUB_PATHS,
  LOCALE_ORDER,
  CATEGORY_ORDER,
  PREVIEW_DIR,
  transliterate,
  slugFor,
  loadRegistry,
  planPages,
  buildPublished,
  buildPreview,
  printableSheetSitemapEntries,
};
