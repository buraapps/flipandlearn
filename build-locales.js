#!/usr/bin/env node
/**
 * build-locales.js — Pre-render per-locale variants of index.html for SEO.
 *
 * Reads index.html (the single source of truth) and emits:
 *   /index.html           (English root, regenerated)
 *   /de/index.html        (and fr, es, it, pt, ro, hu, ar)
 *   /sitemap.xml          (9 URLs with reciprocal hreflang alternates)
 *
 * Idempotent: safe to re-run on every content change.
 *
 * No external dependencies. Uses Node's built-in vm module to safely
 * evaluate the inline T (translations) and M (picker labels) literals
 * that live between the /* __LANG_DATA_BEGIN__ *\/ ... /* __LANG_DATA_END__ *\/
 * markers in index.html.
 *
 * Run with:   node build-locales.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { P, PW } = require('./privacy-strings.js');
const { A } = require('./abc-strings.js');
const { N } = require('./123-strings.js');
const { F } = require('./family-strings.js');
const { buildPublished: buildPublishedPrintables, printableSheetSitemapEntries } = require('./build-printables.js');

// ============================================================
// Per-locale configuration
// ============================================================
const SITE = 'https://flipandlearn.app';

const LOCALES = [
  { code: 'en', path: '/',    ogLocale: 'en_US', dir: 'ltr', isDefault: true  },
  { code: 'de', path: '/de/', ogLocale: 'de_DE', dir: 'ltr', isDefault: false },
  { code: 'fr', path: '/fr/', ogLocale: 'fr_FR', dir: 'ltr', isDefault: false },
  { code: 'es', path: '/es/', ogLocale: 'es_ES', dir: 'ltr', isDefault: false },
  { code: 'it', path: '/it/', ogLocale: 'it_IT', dir: 'ltr', isDefault: false },
  { code: 'pt', path: '/pt/', ogLocale: 'pt_PT', dir: 'ltr', isDefault: false },
  { code: 'ro', path: '/ro/', ogLocale: 'ro_RO', dir: 'ltr', isDefault: false },
  { code: 'hu', path: '/hu/', ogLocale: 'hu_HU', dir: 'ltr', isDefault: false },
  { code: 'pl', path: '/pl/', ogLocale: 'pl_PL', dir: 'ltr', isDefault: false },
  { code: 'nl', path: '/nl/', ogLocale: 'nl_NL', dir: 'ltr', isDefault: false },
  { code: 'ru', path: '/ru/', ogLocale: 'ru_RU', dir: 'ltr', isDefault: false },
  { code: 'uk', path: '/uk/', ogLocale: 'uk_UA', dir: 'ltr', isDefault: false },
  { code: 'bg', path: '/bg/', ogLocale: 'bg_BG', dir: 'ltr', isDefault: false },
  { code: 'tr', path: '/tr/', ogLocale: 'tr_TR', dir: 'ltr', isDefault: false },
  { code: 'cs', path: '/cs/', ogLocale: 'cs_CZ', dir: 'ltr', isDefault: false },
  { code: 'sk', path: '/sk/', ogLocale: 'sk_SK', dir: 'ltr', isDefault: false },
  { code: 'hr', path: '/hr/', ogLocale: 'hr_HR', dir: 'ltr', isDefault: false },
  { code: 'sl', path: '/sl/', ogLocale: 'sl_SI', dir: 'ltr', isDefault: false },
  { code: 'el', path: '/el/', ogLocale: 'el_GR', dir: 'ltr', isDefault: false },
  { code: 'sv', path: '/sv/', ogLocale: 'sv_SE', dir: 'ltr', isDefault: false },
  { code: 'da', path: '/da/', ogLocale: 'da_DK', dir: 'ltr', isDefault: false },
  { code: 'no', path: '/no/', ogLocale: 'nb_NO', dir: 'ltr', isDefault: false }, // Bokmål; ogLocale nb_NO (Facebook has no no_NO)
  { code: 'fi', path: '/fi/', ogLocale: 'fi_FI', dir: 'ltr', isDefault: false },
  { code: 'lt', path: '/lt/', ogLocale: 'lt_LT', dir: 'ltr', isDefault: false },
  { code: 'lv', path: '/lv/', ogLocale: 'lv_LV', dir: 'ltr', isDefault: false },
  { code: 'et', path: '/et/', ogLocale: 'et_EE', dir: 'ltr', isDefault: false },
  { code: 'sq', path: '/sq/', ogLocale: 'sq_AL', dir: 'ltr', isDefault: false },
  { code: 'sr', path: '/sr/', ogLocale: 'sr_RS', dir: 'ltr', isDefault: false }, // Cyrillic script (CLDR default for sr)
  { code: 'ja', path: '/ja/', ogLocale: 'ja_JP', dir: 'ltr', isDefault: false },
  { code: 'ko', path: '/ko/', ogLocale: 'ko_KR', dir: 'ltr', isDefault: false },
  { code: 'ar', path: '/ar/', ogLocale: 'ar_SA', dir: 'rtl', isDefault: false },
];

// Locales that have a blog index at /{code}/blog/. Every other locale must NOT
// render the footer blog link — it would point at a 404. Keep this in sync with
// the blogIndexUrls array in buildSitemap().
const BLOG_INDEX_LOCALES = new Set(['en', 'de', 'ro', 'hu']);

// Locales that have a printables hub. Unlike the blog, the hubs do NOT share a
// uniform slug (/en/printables/, /de/ausmalbilder/, /ro/fise-de-colorat/, /es/fichas-para-colorear/), so the path cannot be derived
// from locale.code and is mapped explicitly below. Every other locale must NOT render
// the footer printables link. Keep this in sync with the printablesUrls array in
// buildSitemap().
const PRINTABLES_LOCALES = new Set(['en', 'de', 'ro', 'es']);
const PRINTABLES_PATHS = { en: '/en/printables/', de: '/de/ausmalbilder/', ro: '/ro/fise-de-colorat/', es: '/es/fichas-para-colorear/' };
// The numbers section of each printables hub (<section id="…">). Only the 123 page's print
// button uses these: the ABC button and every footer link stay on the hub root.
const PRINTABLES_ANCHORS = { en: '#numbers', de: '#numbers', ro: '#numere', es: '#numeros' };
// Locales that render the Teacher Approved stamp in the hero. The badge wording is a
// Google UI string with an official translation per language, so each locale listed here
// needs its own ta.main and ta.sub keys in the T dictionary. The wording has been reviewed
// for all 31 site locales, so this is the full set rather than a pilot gate; a locale left
// out of it still gets the block stripped by rewriteTeacherBadge().
const TEACHER_BADGE_LOCALES = new Set([
  'en','ar','bg','cs','da','de','el','es','et','fi','fr','hr','hu','it','ja','ko',
  'lt','lv','nl','no','pl','pt','ro','ru','sk','sl','sq','sr','sv','tr','uk'
]);

// ------------------------------------------------------------
// App landing pages (/abc/ and /<loc>/abc/ — FLI-394) and their launch gate
// ------------------------------------------------------------

const ROOT = __dirname;

// Apple provider token: the same account-level pt= value the Words store links carry.
const APPLE_PROVIDER_TOKEN = '128736959';

// One entry per app with its own section on the site. `state` is that app's launch gate:
//
//   'hidden'    The app's pages are built, but they — the landing pages and the standalone
//               privacy page — carry `noindex`, show "Coming soon…" instead of store badges,
//               have no apple-itunes-app meta and are NOT in sitemap.xml (the build fails
//               if a URL under the app's path gets in). No page on the site links to them.
//   'preview'   The same as 'hidden', except that the family links to the app are shown.
//               This deliberately links to the page of a not-yet-released app from live
//               pages, and reverses the old rule "nothing may link to /abc/ before launch".
//               The page itself stays noindex with "Coming soon".
//   'launched'  index,follow (privacy page included), store badges with the app's campaign
//               tags, the apple-itunes-app meta, the sitemap entries (the landing pages
//               plus the privacy page) and the family links. The build stops if the app
//               has no numeric App Store ID or no Google Play package: the badges are never
//               rendered with a missing or made-up ID.
//
// Pages, privacy robots, badges, meta and sitemap follow isLaunched(); family links follow
// isVisible(). Any homepage, nav or footer link to an app page must go through isVisible().
const APPS = {
  abc: {
    state: 'preview',
    name: 'Flip &amp; Learn ABC',          // as written in HTML (fallback alt text of the badges)
    segment: 'abc',                        // URL path segment: /abc/, /<loc>/abc/
    marker: 'ABC',                         // template markers: <!-- ABC:NAME --> … <!-- /ABC:NAME -->
    linkPrefix: 'abc',                     // template link ids: abcWordsCta, abcFootWords, …
    keyPrefix: 'abc',                      // i18n keys: abc.meta.title, abc.badge.apple, …
    strings: A,
    stringsFile: 'abc-strings.js',
    source: path.join(ROOT, 'abc', 'index.html'),   // also the EN output
    privacy: path.join(ROOT, 'abc', 'privacy.html'),
    // The app's entry in the family links: its keys in family-strings.js, the mini tiles
    // beside its name, and its accent colour.
    family: {
      keys: 'family',
      accent: '#2A78C8',
      tiles: [['A', '#CA4B25', '#fff'], ['B', '#F5B82E', '#1B2A6B'], ['C', '#1A855A', '#fff']],
    },
    shotsDir: 'abc/shots',                 // home{1,2}-<code>.webp
    campaign: 'web-abc',                   // ct= on Apple, utm_campaign= on Play
    // The digits after "id" in the App Store URL.
    appStoreId: '6822385987',
    // ABC repo android/app/build.gradle.kts applicationId.
    playPackage: 'com.buraapps.flipandlearnabc',
    // Locales whose page is emitted. 'en' is the template itself and must stay in.
    // A locale may be added once the string table has it in full. The hreflang block and
    // the sitemap list exactly these locales; in the page's language switcher a locale in
    // this set links to its app page, every other locale to its homepage.
    locales: new Set(['en', 'hu', 'ro', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'tr', 'cs', 'sk',
      'hr', 'sl', 'sv', 'da', 'no', 'fi', 'lt', 'lv', 'et', 'sq', 'ru', 'uk', 'bg', 'sr', 'el', 'ja', 'ko', 'ar']),
    // The 18 menu languages of the ABC app (ABC repo, lib/l10n/app_<code>.arb). A page in
    // one of these shows its own two Home screenshots (abc/shots/home{1,2}-<code>.webp).
    // Any other page reuses the English screenshots, because that is what the app shows
    // on a device set to that language; its alt text says the menus are in English.
    menuLocales: new Set(['en', 'de', 'es', 'fr', 'it', 'pt', 'ro', 'hu', 'tr', 'sl', 'nl', 'bg', 'uk', 'ru',
      'pl', 'cs', 'sk', 'hr']),
  },
  num: {
    state: 'preview',
    name: 'Flip &amp; Learn 123',
    segment: '123',
    marker: 'NUM',
    linkPrefix: 'num',
    keyPrefix: 'num',
    strings: N,
    stringsFile: '123-strings.js',
    source: path.join(ROOT, '123', 'index.html'),   // also the EN output
    privacy: path.join(ROOT, '123', 'privacy.html'),
    family: {
      keys: 'family.num',
      accent: '#C44618',
      tiles: [['1', '#D93A2B', '#fff'], ['2', '#2A78C8', '#fff'], ['3', '#FFC93C', '#6B2108']],
    },
    shotsDir: '123/shots',
    campaign: 'web-123',
    printablesAnchors: PRINTABLES_ANCHORS,
    appStoreId: '6826912900',
    // Numbers repo android/app/build.gradle.kts applicationId.
    playPackage: 'com.buraapps.flipandlearn_numbers',
    // Grows with 123-strings.js: a locale without a table would emit hreflang for a
    // page that doesn't exist.
    locales: new Set(['en', 'de', 'ro', 'hu', 'es', 'fr', 'it', 'bg', 'cs', 'hr', 'nl', 'pl', 'ru', 'sk', 'sl', 'tr', 'uk',
      'pt', 'ar', 'da', 'el', 'et', 'fi', 'ja', 'ko', 'lt', 'lv', 'no', 'sq', 'sr', 'sv']),
    // The 17 menu languages of the 123 app (Numbers repo, lib/l10n/app_<code>.arb): ABC's
    // 18 without Portuguese. Any other page reuses the English screenshots.
    menuLocales: new Set(['en', 'de', 'es', 'fr', 'it', 'ro', 'hu', 'tr', 'sl', 'nl', 'bg', 'uk', 'ru',
      'pl', 'cs', 'sk', 'hr']),
  },
};
const APP_LIST = Object.values(APPS);

const APP_STATES = ['hidden', 'preview', 'launched'];
function appState(app) {
  if (!APP_STATES.includes(app.state)) {
    throw new Error(`app "${app.segment}": invalid state "${app.state}" (expected ${APP_STATES.join(' | ')})`);
  }
  return app.state;
}
const isLaunched = app => appState(app) === 'launched';
const isVisible = app => appState(app) !== 'hidden';
const appShotLocale = (app, code) => (app.menuLocales.has(code) ? code : 'en');

const SOURCE = path.join(ROOT, 'index.html');
const COOKIES_SOURCE = path.join(ROOT, 'cookies.html');
const PRIVACY_SOURCE = path.join(ROOT, 'privacy.html');
const PRIVACY_WEBSITE_SOURCE = path.join(ROOT, 'privacy-website.html');

// ============================================================
// Helpers
// ============================================================
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrEscape(s) {
  // For attribute values (e.g. alt=""), same escaping is sufficient.
  return htmlEscape(s);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// 1) Extract T and M by evaluating the marked region in a vm sandbox.
// ============================================================
function extractLangData(html) {
  const begin = '/* __LANG_DATA_BEGIN__ */';
  const end = '/* __LANG_DATA_END__ */';
  const i = html.indexOf(begin);
  const j = html.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    throw new Error('LANG_DATA markers not found in index.html');
  }
  const slice = html.slice(i + begin.length, j);
  const sandbox = {};
  vm.createContext(sandbox);
  // The slice declares `const T = {...}; const M = {...};` — wrap as expression
  // returning both.
  vm.runInContext(slice + '\nthis.__T = T; this.__M = M;', sandbox);
  if (!sandbox.__T || !sandbox.__M) {
    throw new Error('Failed to extract T or M from index.html');
  }
  return { T: sandbox.__T, M: sandbox.__M };
}

// ============================================================
// 2) Compute per-locale derived strings (title, description) from existing T keys.
//    Source: title = "Flip & Learn — {b2} · {b1}";  description = T[l]['hero.sub'].
//    All three keys (b1, b2, hero.sub) are present in every locale — verified in Phase 1.
// ============================================================
function derivedMeta(T, code) {
  const t = T[code];
  if (!t) throw new Error(`Locale "${code}" missing from T`);
  for (const k of ['b1', 'b2', 'hero.sub']) {
    if (typeof t[k] !== 'string') {
      throw new Error(`Locale "${code}" missing required key "${k}"`);
    }
  }
  return {
    title: `Flip & Learn — ${t['b2']} · ${t['b1']}`,
    description: t['hero.sub'],
  };
}

// ============================================================
// 3) Apply ALL setLang() text mutations as static substitutions on the HTML string.
//    Mirrors every mutation enumerated in the Phase 1 audit §2.
// ============================================================
function applyDataI18nText(html, T, code) {
  const t = T[code];
  // Match opening tag with data-i18n="key" and replace inner text up to its close tag.
  // Constraint observed in the source: every data-i18n element is text-only
  // (no nested HTML). data-i18n-html is referenced in JS but unused in markup
  // (verified Phase 1).
  //
  // Regex captures:
  //   $1 = opening tag (everything from < through the > that closes the open tag)
  //   $2 = tag name
  //   $3 = i18n key
  // We rebuild as: $1 + escaped(T[code][$3]) + </$2>
  //
  // We DO NOT match data-i18n-aria (aria-label only) — handled separately below.
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?\bdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
  return html.replace(tagRe, (match, tagName, attrs, key, _inner) => {
    // Skip data-i18n-html (would need raw HTML; not present in markup but defensive).
    if (/\bdata-i18n-html\b/.test(attrs)) return match;
    const v = t[key];
    if (typeof v !== 'string') return match; // unknown key — leave as default
    return `<${tagName}${attrs}>${htmlEscape(v)}</${tagName}>`;
  });
}

// Raw-HTML substitution for data-i18n-html elements (legal text with inline
// <a>/<strong>/<em>/<code>). Mirrors applyDataI18nText but WITHOUT htmlEscape
// so the inline tags pass through.
function applyDataI18nHtml(html, dict) {
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?\bdata-i18n-html="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
  return html.replace(re, (match, tagName, attrs, key, _inner) => {
    const v = dict[key];
    if (typeof v !== 'string') return match;
    return `<${tagName}${attrs}>${v}</${tagName}>`;
  });
}

function applyDataI18nAria(html, T, code) {
  // <button ... aria-label="X" data-i18n-aria="key">  →  set aria-label to T[code][key]
  // Operate on the opening tag only.
  const t = T[code];
  // Match an opening tag containing data-i18n-aria="key".
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?\bdata-i18n-aria="([^"]+)"[^>]*)>/g;
  return html.replace(re, (match, tagName, attrs, key) => {
    const v = t[key];
    if (typeof v !== 'string') return match;
    // Replace existing aria-label="..." inside attrs, or add one.
    let newAttrs;
    if (/\baria-label="[^"]*"/.test(attrs)) {
      newAttrs = attrs.replace(/\baria-label="[^"]*"/, `aria-label="${attrEscape(v)}"`);
    } else {
      newAttrs = ` aria-label="${attrEscape(v)}"` + attrs;
    }
    return `<${tagName}${newAttrs}>`;
  });
}

// ============================================================
// 4) Per-locale head/meta/badge/picker/body rewrites
// ============================================================
function rewriteHead(html, locale, T, M) {
  const t = T[locale.code];
  const meta = derivedMeta(T, locale.code);
  const canonical = `${SITE}${locale.path}`;

  // <title>
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${htmlEscape(meta.title)}</title>`
  );

  // <meta name="description">
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${attrEscape(meta.description)}">`
  );

  // <link rel="canonical">
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${canonical}">`
  );

  // Replace the entire hreflang block + canonical-comment with a per-locale block.
  // Source has: <!-- Canonical + hreflang (FLI-51) --> followed by canonical + 10 alternates.
  const hreflangBlockRe = /<link rel="canonical" href="[^"]*">\s*((?:<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*)+)/;
  const altLinks = LOCALES
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}">`)
    .join('\n');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${SITE}/">`;
  html = html.replace(
    hreflangBlockRe,
    `<link rel="canonical" href="${canonical}">\n${altLinks}\n${xDefault}\n`
  );

  // Open Graph: og:url, og:title, og:description, og:locale, og:locale:alternate
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${canonical}">`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${attrEscape(meta.title)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${attrEscape(meta.description)}">`
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`
  );
  // Replace the og:locale:alternate block (1+ lines) with the other 8 locales.
  const altLocaleRe = /(?:<meta property="og:locale:alternate" content="[^"]*">\s*)+/;
  const altLocales = LOCALES
    .filter(l => l.code !== locale.code)
    .map(l => `<meta property="og:locale:alternate" content="${l.ogLocale}">`)
    .join('\n');
  html = html.replace(altLocaleRe, altLocales + '\n');

  // Twitter: twitter:title, twitter:description
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${attrEscape(meta.title)}">`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${attrEscape(meta.description)}">`
  );

  // Inject (or replace) the __pageLocale marker right before the pre-paint script.
  const pageLocaleScript = `<script>window.__pageLocale=${JSON.stringify(locale.code)};</script>`;
  if (/<script>window\.__pageLocale=/.test(html)) {
    html = html.replace(
      /<script>window\.__pageLocale=[^<]*<\/script>/,
      pageLocaleScript
    );
  } else {
    html = html.replace(
      /(<!-- FLI-102: Pre-paint locale\/dir from localStorage to prevent RTL FOUC -->)/,
      `${pageLocaleScript}\n$1`
    );
  }

  return html;
}

function rewriteHtmlTag(html, locale) {
  // <html lang="xx" [dir="rtl"]>
  const dirAttr = locale.dir === 'rtl' ? ' dir="rtl"' : '';
  return html.replace(/<html\b[^>]*>/, `<html lang="${locale.code}"${dirAttr}>`);
}

function rewriteBodyTag(html, locale) {
  // For Arabic, body must carry the .rtl class so the existing CSS hooks (body.rtl ...) fire.
  if (locale.dir === 'rtl') {
    if (/<body\s/.test(html)) {
      return html.replace(/<body\b([^>]*)>/, (m, attrs) => {
        if (/\bclass="[^"]*"/.test(attrs)) {
          return `<body${attrs.replace(/\bclass="([^"]*)"/, (_m2, cls) => `class="${cls} rtl"`.replace(/\s+/, ' '))}>`;
        }
        return `<body${attrs} class="rtl">`;
      });
    }
    return html.replace(/<body\b([^>]*)>/, `<body$1 class="rtl">`);
  }
  // LTR: ensure no leftover rtl class.
  return html.replace(/<body\b([^>]*)>/, (m, attrs) => {
    const cleaned = attrs.replace(/\bclass="([^"]*)"/, (_m2, cls) => {
      const next = cls.split(/\s+/).filter(c => c && c !== 'rtl').join(' ');
      return next ? `class="${next}"` : '';
    }).replace(/\s+/g, ' ').replace(/\s$/, '');
    return `<body${cleaned ? ' ' + cleaned.trimStart() : ''}>`;
  });
}

function rewriteBadges(html, locale, T) {
  const t = T[locale.code];
  // App Store badge: src + localized alt (from T['btn'])
  html = html.replace(
    /<img id="appstore-badge" src="[^"]*" alt="[^"]*"/,
    `<img id="appstore-badge" src="/badges/app-store-badge-${locale.code}.svg" alt="${attrEscape(t['btn'] || 'Download on the App Store')}"`
  );
  // Play Store badge: src + localized alt (from T['btn.gp'])
  html = html.replace(
    /<img id="playstore-badge" src="[^"]*" alt="[^"]*"/,
    `<img id="playstore-badge" src="/badges/google-play-badge-${locale.code}.png" alt="${attrEscape(t['btn.gp'] || 'Get it on Google Play')}"`
  );
  return html;
}

function rewriteLangButton(html, locale, M) {
  const m = M[locale.code];
  // <button class="lang-btn" id="langBtn" onclick="toggleMenu()">🇬🇧 EN ▾</button>
  return html.replace(
    /(<button class="lang-btn" id="langBtn" onclick="toggleMenu\(\)">)[^<]*(<\/button>)/,
    `$1${m.f} ${m.l} ▾$2`
  );
}

function rewritePickerActive(html, locale) {
  // Strip the 'active' class from whichever lang-opt currently has it,
  // then add it back on the one matching this locale.
  // First pass: remove " active" from any lang-opt that has it.
  html = html.replace(
    /<a class="lang-opt active"/g,
    '<a class="lang-opt"'
  );
  // Second pass: add 'active' to the picker entry for this locale.
  html = html.replace(
    new RegExp(`<a class="lang-opt" data-lang="${locale.code}"`),
    `<a class="lang-opt active" data-lang="${locale.code}"`
  );
  return html;
}

// Footer credits link (FLI-366) needs no rewrite: it is a static absolute
// `/credits.html` anchor on every locale, and only its label is localized through the
// "nav.credits" T key like any other data-i18n text.
//
// Footer blog link. Locales in BLOG_INDEX_LOCALES get an href pointing at their
// own index (/en/blog/, /de/blog/, ...); note the EN index lives at /en/blog/,
// not at the locale root path '/'. Every other locale has the anchor removed
// entirely so no page links to a blog index that does not exist.
function rewriteBlogLink(html, locale) {
  const anchorRe = /\s*<a href="[^"]*" id="blogLink" data-i18n="nav\.blog">[^<]*<\/a>/;
  if (!BLOG_INDEX_LOCALES.has(locale.code)) {
    return html.replace(anchorRe, '');
  }
  return html.replace(
    anchorRe,
    `\n    <a href="/${locale.code}/blog/" id="blogLink" data-i18n="nav.blog">Blog</a>`
  );
}

// Footer printables link. Mirrors rewriteBlogLink, except the href comes from the
// explicit PRINTABLES_PATHS map rather than being built from locale.code, because the
// German hub lives at /de/ausmalbilder/, the Romanian one at /ro/fise-de-colorat/ and the
// Spanish one at /es/fichas-para-colorear/.
function rewritePrintablesLink(html, locale) {
  const anchorRe = /\s*<a href="[^"]*" id="printablesLink" data-i18n="nav\.printables">[^<]*<\/a>/;
  if (!PRINTABLES_LOCALES.has(locale.code)) {
    return html.replace(anchorRe, '');
  }
  return html.replace(
    anchorRe,
    `\n    <a href="${PRINTABLES_PATHS[locale.code]}" id="printablesLink" data-i18n="nav.printables">Printables</a>`
  );
}

// Hero Teacher Approved stamp. Mirrors rewriteBlogLink/rewritePrintablesLink, except the
// block is multi-line, so it is delimited by HTML comments in the source rather than matched
// by a unique id. Locales outside TEACHER_BADGE_LOCALES get the whole block removed, leading
// whitespace included, so no page claims a badge in a language whose wording is not reviewed.
function rewriteTeacherBadge(html, locale) {
  if (TEACHER_BADGE_LOCALES.has(locale.code)) return html;
  return html.replace(/\n[ \t]*<!-- TA-START -->[\s\S]*?<!-- TA-END -->/, '');
}

// ============================================================
// 5) Build a single locale variant
// ============================================================
// ============================================================
// 5a) Family links: each page links to the other apps that are visible.
//    A "More from Flip & Learn" card and a footer link per sibling, plus their CSS. In the
//    header nav: a direct link with one sibling, a single "More apps" link to the card
//    region with two or more. A page's siblings are the APP_LIST entries that are isVisible(), without
//    the app the page belongs to, so a page has none while every other app is 'hidden'
//    and then gets nothing at all. In 'preview' these live pages deliberately link to the
//    page of a not-yet-released app (see APPS). Strings from family-strings.js.
//
//    Every piece is wrapped in a marker pair, <!-- FAMILY:NAME --> … <!-- /FAMILY:NAME -->,
//    and stripFamily() removes all of them from each source (index.html and the app
//    templates) before anything else reads it. Because a source is also its EN output,
//    that is what makes the switch reversible and the build idempotent: visible, the
//    blocks are added; state back to 'hidden', the next build removes them and every
//    page is byte-identical to the hidden state again.
// ============================================================
const FAMILY_REGION_ID = 'more-apps';

const FAMILY_ANCHORS = {
  // on the Words homepage. Each must occur exactly once, or the build stops
  nav: '\n    <a href="/credits.html" data-i18n="nav.credits">Credits</a>',
  card: '\n<section id="support">',
  foot: '\n    <a href="#" id="cookiePrefs"',
  css: '\n</head>',
};

function stripFamily(html) {
  return html.replace(/\n[ \t]*<!-- FAMILY:([A-Z]+) -->[\s\S]*?<!-- \/FAMILY:\1 -->/g, '');
}

// The same four anchors on an app's page, from the template shared by every app page.
function familyAnchors(host) {
  if (!host) return FAMILY_ANCHORS;
  return {
    nav: `\n        <a href="#words" data-i18n="${host.keyPrefix}.nav.words">Flip &amp; Learn: Word Card Game</a>`,
    card: `\n<!-- ${host.marker}:PRINTABLES_BEGIN -->`,
    foot: `\n      <a href="/${host.segment}/privacy.html" data-i18n="${host.keyPrefix}.foot.privacy"`,
    css: '\n</head>',
  };
}

function familyCss(siblings, host) {
  const perApp = siblings.map(app => {
    const c = `.fam-card-${app.segment}`;
    return `${c}{--fam-accent:${app.family.accent}}\n` + app.family.tiles
      .map(([, bg, fg], i) => `${c} .fam-tiles span:nth-child(${i + 1}){background:${bg};color:${fg}}`).join('\n');
  }).join('\n');
  const extra = [
    // On an app page the sibling link waits until 1024px: from 861px, where that nav
    // appears, it wraps at 900px in most locales.
    ...(host ? ['.top-nav .fam-navlink{display:none}', '@media (min-width:1024px){.top-nav .fam-navlink{display:inline}}'] : []),
    // The jump target of "More apps" lands right below the 56px sticky nav of the homepage.
    ...(siblings.length > 1 ? [`#${FAMILY_REGION_ID}{scroll-margin-top:56px}`] : []),
  ].map(rule => `\n${rule}`).join('');
  return `<style>
/* Family card. Words-site styling with the app's accent: coloured edge and the app's tiles
   in miniature. Logical properties only (RTL on /ar/). */
.fam-wrap{background:#fff}
.fam-wrap section{padding-block:56px;padding-inline:24px}
.fam-wrap section+section{padding-block-start:0}
.fam-card{display:flex;align-items:center;gap:22px;max-width:760px;margin:0 auto;background:#fff;border:1px solid #e3e2f5;border-inline-start:6px solid var(--fam-accent);border-radius:18px;padding:26px 28px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.fam-icon{flex:none;width:72px;height:auto;border-radius:22.5%;box-shadow:0 4px 0 #1B2A6B}
.fam-body{flex:1 1 auto;min-width:0}
.fam-eyebrow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 6px;font-size:13px;font-weight:600;color:var(--fam-accent)}
.fam-new{display:inline-block;background:var(--fam-accent);color:#fff;font-size:11px;font-weight:700;line-height:1;padding:4px 8px;border-radius:999px}
.fam-card .fam-title{margin:0 0 6px;font-size:22px;font-weight:700;text-align:start;color:#1d1d1f}
.fam-text{margin:0 0 4px;font-size:15px;line-height:1.5;color:#3a3a3c}
.fam-facts{margin:0;font-size:13px;color:#6e6e73}
.fam-tiles{display:inline-flex;gap:4px;margin-inline-start:4px;vertical-align:middle}
.fam-tiles span{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;font-size:12px;font-weight:800;line-height:1}
${perApp}
.fam-btn{flex:none;display:inline-block;background:#3A3589;color:#fff;padding:12px 22px;border-radius:11px;text-decoration:none;font-weight:600;font-size:14px;text-align:center}
.fam-btn:hover{background:#2e2a70}
.fam-btn:focus-visible,.fam-navlink:focus-visible{outline:3px solid var(--fam-accent,#3A3589);outline-offset:2px}
/* Header nav link: desktop only. With it, the nav no longer fits one row below 1200px in
   the longest locales (ru wraps at 1024px); the footer link is shown at every width. */
.nav-links .fam-navlink{display:none}
@media (min-width:1200px){.nav-links .fam-navlink{display:inline}}
@media (max-width:640px){.fam-card{flex-wrap:wrap;gap:16px;padding:22px 20px}.fam-icon{width:60px}.fam-body{flex-basis:calc(100% - 76px)}.fam-btn{flex:1 1 100%}}${extra}
</style>`;
}

function familyBlock(name, inner, indent = '') {
  return `\n${indent}<!-- FAMILY:${name} -->${inner}<!-- /FAMILY:${name} -->`;
}

// `host` is the app whose page this is, or null for the Words homepage.
function applyFamily(html, locale, host = null) {
  const siblings = APP_LIST.filter(app => app !== host && isVisible(app));
  if (!siblings.length) return html;
  const f = F[locale.code];
  const e = htmlEscape;
  const anchors = familyAnchors(host);
  for (const [name, anchor] of Object.entries(anchors)) {
    const n = html.split(anchor).length - 1;
    if (n !== 1) throw new Error(`family card: anchor "${name}" occurs ${n} times in ${host ? `${host.segment}/index.html` : 'index.html'} (expected exactly 1)`);
  }
  // A locale the sibling has no page in yet links to its English page, never to a 404.
  const en = LOCALES.find(l => l.isDefault);
  const hrefOf = app => appPath(app, app.locales.has(locale.code) ? locale : en);
  const str = (app, key) => f[`${app.family.keys}.${key}`];
  const cards = siblings.map((app, i) => {
    const titleId = i === 0 ? 'famTitle' : `famTitle-${app.segment}`;
    const tiles = app.family.tiles.map(([t]) => `<span>${t}</span>`).join('');
    return `<section aria-labelledby="${titleId}">
  <div class="fam-card fam-card-${app.segment}">
    <img class="fam-icon" src="/${app.segment}/app-icon-144.webp" srcset="/${app.segment}/app-icon-96.webp 1.3x, /${app.segment}/app-icon-144.webp 2x" alt="" width="72" height="72" loading="lazy" decoding="async">
    <div class="fam-body">
      <p class="fam-eyebrow"><span>${e(f['family.eyebrow'])}</span><span class="fam-new">${e(f['family.new'])}</span></p>
      <h2 class="fam-title" id="${titleId}">${app.name}<span class="fam-tiles" aria-hidden="true" dir="ltr">${tiles}</span></h2>
      <p class="fam-text">${e(str(app, 'text'))}</p>
      <p class="fam-facts">${e(str(app, 'facts'))}</p>
    </div>
    <a class="fam-btn" href="${hrefOf(app)}">${e(str(app, 'cta'))}</a>
  </div>
</section>`;
  }).join('\n');
  const card = `
<div class="fam-wrap"${siblings.length > 1 ? ` id="${FAMILY_REGION_ID}"` : ''}>
${cards}
</div>
`;
  const nav = siblings.length > 1
    ? `<a class="fam-navlink" href="#${FAMILY_REGION_ID}">${e(f['family.more'])}</a>`
    : `<a class="fam-navlink" href="${hrefOf(siblings[0])}">${e(str(siblings[0], 'nav'))}</a>`;
  const foot = siblings.map(app => `<a href="${hrefOf(app)}">${e(str(app, 'foot'))}</a>`).join(' ');
  html = html.replace(anchors.css, () => familyBlock('CSS', familyCss(siblings, host)) + anchors.css);
  html = html.replace(anchors.nav, () => anchors.nav + familyBlock('NAV', nav, '    '));
  html = html.replace(anchors.card, () => familyBlock('CARD', card) + anchors.card);
  html = html.replace(anchors.foot, () => familyBlock('FOOT', foot, '    ') + anchors.foot);
  return html;
}

function buildLocale(sourceHtml, locale, T, M) {
  // First, while the anchors are still the English template text; the family
  // markup has no data-i18n, so the steps below leave it alone.
  let html = applyFamily(sourceHtml, locale);
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewriteHead(html, locale, T, M);
  html = rewriteBadges(html, locale, T);
  html = rewriteLangButton(html, locale, M);
  html = rewritePickerActive(html, locale);
  html = rewriteBlogLink(html, locale);
  html = rewritePrintablesLink(html, locale);
  html = rewriteTeacherBadge(html, locale);
  html = applyDataI18nText(html, T, locale.code);
  html = applyDataI18nAria(html, T, locale.code);
  return html;
}

// ============================================================
// 5b) Build a single locale variant of cookies.html.
//    Mirrors buildLocale() but only the rewrites that apply to the cookies template
//    (no badges, no language picker, no __pageLocale marker) and computes per-locale
//    title/description/canonical from the existing cookies.* T keys.
// ============================================================
function rewriteCookiesHead(html, locale, T) {
  const t = T[locale.code];
  const cookiesUrl = `${SITE}${locale.path}cookies.html`;
  const titleText = `${t['cookies.h']} — Flip & Learn`;
  // Use cookies.p1 as the meta description (first paragraph is the natural summary).
  const descText = t['cookies.p1'];

  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${htmlEscape(titleText)}</title>`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${cookiesUrl}">`
  );

  // Replace the hreflang block (canonical + N alternates) with this locale's view.
  const hreflangBlockRe = /<link rel="canonical" href="[^"]*">\s*((?:<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*)+)/;
  const altLinks = LOCALES
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}cookies.html">`)
    .join('\n');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${SITE}/cookies.html">`;
  html = html.replace(
    hreflangBlockRe,
    `<link rel="canonical" href="${cookiesUrl}">\n${altLinks}\n${xDefault}\n`
  );

  // Open Graph
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${cookiesUrl}">`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${attrEscape(titleText)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`
  );

  return html;
}

function buildCookiesLocale(sourceHtml, locale, T) {
  let html = sourceHtml;
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewriteCookiesHead(html, locale, T);
  html = applyDataI18nText(html, T, locale.code);
  html = applyDataI18nAria(html, T, locale.code);
  return html;
}

// ============================================================
// 5c) Per-locale build for privacy.html and privacy-website.html.
//    Both templates carry data-i18n (text) and data-i18n-html (raw inline HTML)
//    attributes. We merge T[code] (for shared cookie.* banner keys) with the
//    privacy-specific dict (P or PW) and run both substitution passes.
// ============================================================
function rewritePrivacyHead(html, locale, mergedDict) {
  const t = mergedDict;
  const url = `${SITE}${locale.path}privacy.html`;
  const titleText = `${t['p.title']} — Flip & Learn`;
  const descText = t['p.desc'];

  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${htmlEscape(titleText)}</title>`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${url}">`
  );

  // Replace the hreflang block (canonical + N alternates) with this locale's view.
  const hreflangBlockRe = /<link rel="canonical" href="[^"]*">\s*((?:<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*)+)/;
  const altLinks = LOCALES
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}privacy.html">`)
    .join('\n');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${SITE}/privacy.html">`;
  html = html.replace(
    hreflangBlockRe,
    `<link rel="canonical" href="${url}">\n${altLinks}\n${xDefault}\n`
  );

  // Open Graph
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${url}">`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${attrEscape(titleText)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`
  );

  return html;
}

function rewritePrivacyWebsiteHead(html, locale, mergedDict) {
  const t = mergedDict;
  const url = `${SITE}${locale.path}privacy-website.html`;
  const titleText = `${t['pw.title']} — Flip & Learn`;
  const descText = t['pw.desc'];

  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${htmlEscape(titleText)}</title>`
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${url}">`
  );

  const hreflangBlockRe = /<link rel="canonical" href="[^"]*">\s*((?:<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*)+)/;
  const altLinks = LOCALES
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}privacy-website.html">`)
    .join('\n');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${SITE}/privacy-website.html">`;
  html = html.replace(
    hreflangBlockRe,
    `<link rel="canonical" href="${url}">\n${altLinks}\n${xDefault}\n`
  );

  html = html.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${url}">`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${attrEscape(titleText)}">`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${attrEscape(descText)}">`
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`
  );

  return html;
}

// Merge the cookie.* banner keys (from T) with the privacy-specific dict (P or PW)
// so both passes can resolve their keys from a single per-locale dictionary.
function mergePrivacyDict(T, extra, code) {
  return Object.assign({}, T[code] || {}, extra[code] || {});
}

function buildPrivacyLocale(sourceHtml, locale, T, P) {
  const merged = mergePrivacyDict(T, P, locale.code);
  // applyDataI18nText / applyDataI18nAria expect a {code: dict} map keyed by locale.
  const wrap = { [locale.code]: merged };
  let html = sourceHtml;
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewritePrivacyHead(html, locale, merged);
  html = applyDataI18nText(html, wrap, locale.code);
  html = applyDataI18nHtml(html, merged);
  html = applyDataI18nAria(html, wrap, locale.code);
  return html;
}

function buildPrivacyWebsiteLocale(sourceHtml, locale, T, PW) {
  const merged = mergePrivacyDict(T, PW, locale.code);
  const wrap = { [locale.code]: merged };
  let html = sourceHtml;
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewritePrivacyWebsiteHead(html, locale, merged);
  html = applyDataI18nText(html, wrap, locale.code);
  html = applyDataI18nHtml(html, merged);
  html = applyDataI18nAria(html, wrap, locale.code);
  return html;
}

// ============================================================
// 5d) App landing pages (FLI-394; config in APPS).
//    Template: app.source (also the EN output, like index.html). Strings: app.strings,
//    merged over T[code] for the shared cookie.* / nav.* keys.
//    The template keeps permanent <!-- ABC:NAME --> … <!-- /ABC:NAME --> marker pairs
//    (prefix: app.marker); the build replaces what is between them, so a block that is
//    empty in one state (no badges before launch) is never lost from the source.
// ============================================================
function appPath(app, locale) {
  return `${locale.path}${app.segment}/`;
}

function fillAppMarker(app, html, name, content) {
  const re = new RegExp(`<!-- ${app.marker}:${name} -->[\\s\\S]*?<!-- /${app.marker}:${name} -->`);
  if (!re.test(html)) throw new Error(`${app.segment}/index.html: marker ${app.marker}:${name} not found`);
  return html.replace(re, () => `<!-- ${app.marker}:${name} -->\n${content}${content ? '\n' : ''}<!-- /${app.marker}:${name} -->`);
}

// The shared chrome of the Words homepage, taken from index.html so an app page
// inherits it unchanged: the consent-gated Google Ads loader, the cookie banner (CSS,
// markup, controller), the store_click handler, the Cloudflare Web Analytics beacon
// (cookieless; same snippet, same place at the end of <body>) and the language names
// of the picker.
// Each piece must be found, or the build stops.
function extractSharedChrome(source) {
  const need = (m, what) => {
    if (!m) throw new Error(`index.html: shared chrome not found (${what})`);
    return m;
  };
  const loader = need(
    /<!-- FLI-cookie-consent: Google Ads tag[^>]*-->\s*<script>[\s\S]*?<\/script>/.exec(source),
    'consent-gated gtag loader')[0];
  const cssLines = source.match(/^(?:\.cc-|body\.rtl \.cc-|@media\(max-width:600px\)\{\.cc-).*$/gm) || [];
  if (cssLines.length < 10 || !cssLines.some(l => l.startsWith('.cc-banner.cc-show'))) {
    throw new Error('index.html: shared chrome not found (cookie banner CSS)');
  }
  const banner = need(
    /<div class="cc-banner" id="ccBanner"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(source),
    'cookie banner markup')[0];
  const script = need(
    /\/\/ FLI-cookie-consent: banner controller[\s\S]*?(?=\/\/ FLI-61:)/.exec(source),
    'banner controller + store_click handler')[0].trim();
  if (!script.includes("'store_click'")) {
    throw new Error('index.html: shared chrome not found (store_click handler)');
  }
  const beacon = need(
    /<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->/.exec(source),
    'Cloudflare Web Analytics beacon')[0];
  // Picker entries are "<flag> <name>"; an app page shows the name only (no emoji).
  const names = {};
  const optRe = /<a class="lang-opt[^"]*" data-lang="([a-z]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = optRe.exec(source))) names[m[1]] = m[2].trim().replace(/^\S+\s+/, '');
  for (const l of LOCALES) {
    if (!names[l.code]) throw new Error(`index.html: no language-picker entry for "${l.code}"`);
  }
  return { loader, css: cssLines.join('\n'), banner, script, beacon, names };
}

function appLangMenu(app, locale, M, names) {
  const items = LOCALES.map(l => {
    const href = app.locales.has(l.code) ? appPath(app, l) : l.path;
    const active = l.code === locale.code;
    return `          <a class="lang-opt${active ? ' active' : ''}" data-lang="${l.code}" lang="${l.code}" hreflang="${l.code}" href="${href}"${active ? ' aria-current="page"' : ''} onclick="try{localStorage.setItem('flipandlearn_lang','${l.code}')}catch(e){}">${htmlEscape(names[l.code])}</a>`;
  }).join('\n');
  return `      <details class="lang">
        <summary aria-label="Change page language" data-i18n-aria="${app.keyPrefix}.lang.aria">${M[locale.code].l}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
        <div class="lang-menu">
${items}
        </div>
      </details>`;
}

// Hero call to action. Before launch: a plain status line (clock icon + "Coming
// soon…"), not a link or button and not styled like one; no store links.
// After launch: the store badges with the app's campaign tags, which the shared
// store_click handler reads (ct= on Apple, utm_campaign= on Play).
function appCta(app, locale) {
  if (!isLaunched(app)) {
    return `      <p class="soon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span data-i18n="${app.keyPrefix}.hero.soon">Coming soon to the App Store and Google Play</span></p>`;
  }
  const apple = `https://apps.apple.com/app/id${app.appStoreId}?pt=${APPLE_PROVIDER_TOKEN}&amp;ct=${app.campaign}&amp;mt=8`;
  const play = `https://play.google.com/store/apps/details?id=${app.playPackage}&amp;referrer=utm_source%3Dflipandlearn.app%26utm_medium%3Dweb%26utm_campaign%3D${app.campaign}`;
  return `      <div class="dl-badges">
        <a href="${apple}" target="_blank" rel="noopener"><img src="/badges/app-store-badge-${locale.code}.svg" alt="Download ${app.name} on the App Store" data-i18n-alt="${app.keyPrefix}.badge.apple" width="180" height="60"></a>
        <a href="${play}" target="_blank" rel="noopener"><img src="/badges/google-play-badge-${locale.code}.png" alt="Get ${app.name} on Google Play" data-i18n-alt="${app.keyPrefix}.badge.play" width="180" height="60" decoding="async"></a>
      </div>`;
}

function rewriteAppHead(app, html, locale, dict) {
  const url = `${SITE}${appPath(app, locale)}`;
  const titleText = dict[`${app.keyPrefix}.meta.title`];
  const descText = dict[`${app.keyPrefix}.meta.desc`];

  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${htmlEscape(titleText)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/,
    () => `<meta name="description" content="${attrEscape(descText)}">`);
  html = html.replace(/<meta name="robots" content="[^"]*">/,
    `<meta name="robots" content="${isLaunched(app) ? 'index,follow' : 'noindex'}">`);
  html = fillAppMarker(app, html, 'STORE_META',
    isLaunched(app) ? `<meta name="apple-itunes-app" content="app-id=${app.appStoreId}">` : '');

  // Canonical + hreflang: only the locales that have a page of this app, x-default → EN.
  const en = LOCALES.find(l => l.code === 'en');
  const alternates = LOCALES.filter(l => app.locales.has(l.code))
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${appPath(app, l)}">`)
    .join('\n');
  html = fillAppMarker(app, html, 'HREFLANG',
    `<link rel="canonical" href="${url}">\n${alternates}\n<link rel="alternate" hreflang="x-default" href="${SITE}${appPath(app, en)}">`);

  html = html.replace(/<meta property="og:title" content="[^"]*">/,
    () => `<meta property="og:title" content="${attrEscape(titleText)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/,
    () => `<meta property="og:description" content="${attrEscape(descText)}">`);
  html = html.replace(/<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${url}">`);
  html = html.replace(/<meta property="og:image:alt" content="[^"]*">/,
    () => `<meta property="og:image:alt" content="${attrEscape(dict[`${app.keyPrefix}.meta.ogalt`])}">`);
  html = html.replace(/<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*">/,
    () => `<meta name="twitter:title" content="${attrEscape(titleText)}">`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*">/,
    () => `<meta name="twitter:description" content="${attrEscape(descText)}">`);
  return html;
}

// Links from an app page to the rest of the site, per locale. EN always keeps every
// link, so the template (the EN output) never loses one.
function rewriteAppLinks(app, html, locale) {
  const id = name => `${app.linkPrefix}${name}`;
  const setHref = (id, href) => {
    const re = new RegExp(`(<a\\b[^>]*\\bid="${id}"[^>]*\\bhref=")[^"]*(")|(<a\\b[^>]*\\bhref=")[^"]*("[^>]*\\bid="${id}")`);
    if (!re.test(html)) throw new Error(`${app.segment}/index.html: link #${id} not found`);
    html = html.replace(re, (m, a, b, c, d) => (a ? `${a}${href}${b}` : `${c}${href}${d}`));
  };
  const dropLink = id => {
    html = html.replace(new RegExp(`\\s*<a\\b[^>]*\\bid="${id}"[^>]*>[^<]*<\\/a>`), '');
  };
  setHref(id('WordsCta'), locale.path);
  setHref(id('FootWords'), locale.path);
  if (BLOG_INDEX_LOCALES.has(locale.code)) setHref(id('FootBlog'), `/${locale.code}/blog/`);
  else dropLink(id('FootBlog'));
  if (PRINTABLES_LOCALES.has(locale.code)) {
    setHref(id('FootPrint'), PRINTABLES_PATHS[locale.code]);
    setHref(id('PrintCta'), PRINTABLES_PATHS[locale.code] + ((app.printablesAnchors || {})[locale.code] || ''));
  } else {
    dropLink(id('FootPrint'));
    html = html.replace(new RegExp(`<!-- ${app.marker}:PRINTABLES_BEGIN -->[\\s\\S]*?<!-- ${app.marker}:PRINTABLES_END -->\\s*`), '');
  }
  return html;
}

// An app's privacy page is a standalone, hand-written page. The build changes exactly
// one thing in it: the robots meta follows isLaunched() (noindex when hidden or in
// preview, index,follow when launched). Every other byte stays as it is.
function rewriteAppPrivacyRobots(app, html) {
  const re = /<meta name="robots" content="[^"]*">/;
  if (!re.test(html)) throw new Error(`${app.segment}/privacy.html: robots meta not found`);
  return html.replace(re, `<meta name="robots" content="${isLaunched(app) ? 'index,follow' : 'noindex'}">`);
}

// alt="" from a data-i18n-alt key (the store badges).
function applyDataI18nAlt(html, dict) {
  return html.replace(/<img\b([^>]*?\bdata-i18n-alt="([^"]+)"[^>]*)>/g, (match, attrs, key) => {
    const v = dict[key];
    if (typeof v !== 'string') return match;
    return `<img${attrs.replace(/\balt="[^"]*"/, () => `alt="${attrEscape(v)}"`)}>`;
  });
}

function buildAppLocale(app, sourceHtml, locale, T, M, chrome) {
  const merged = Object.assign({}, T[locale.code] || {}, app.strings[locale.code] || {});
  const wrap = { [locale.code]: merged };
  // First, while the anchors are still the English template text, as in buildLocale.
  let html = applyFamily(sourceHtml, locale, app);
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewriteAppHead(app, html, locale, merged);
  html = fillAppMarker(app, html, 'CONSENT_HEAD', `${chrome.loader}\n<style>\n${chrome.css}\n</style>`);
  html = fillAppMarker(app, html, 'LANG', appLangMenu(app, locale, M, chrome.names));
  html = fillAppMarker(app, html, 'CTA', appCta(app, locale));
  // The banner's "Learn more" link is relative on the homepage; from an app page it has to
  // point at this locale's cookies page explicitly.
  const banner = chrome.banner.replace('href="cookies.html"', `href="${locale.path}cookies.html"`);
  html = fillAppMarker(app, html, 'CONSENT_BODY', `${banner}\n<script>\n${chrome.script}\n</script>\n\n${chrome.beacon}`);
  html = rewriteAppLinks(app, html, locale);
  // Hero phone: this locale's screenshots of the app's two Home pages.
  html = html.replace(new RegExp(`/${app.shotsDir}/home([12])-en\\.webp`, 'g'), `/${app.shotsDir}/home$1-${appShotLocale(app, locale.code)}.webp`);
  html = applyDataI18nText(html, wrap, locale.code);
  html = applyDataI18nHtml(html, merged);
  html = applyDataI18nAria(html, wrap, locale.code);
  html = applyDataI18nAlt(html, merged);
  return html;
}

// ============================================================
// 6) Sitemap
// ============================================================
//
// lastmod is PRESERVED across builds. The committed sitemap.xml is read before it is
// regenerated, and each URL keeps the <lastmod> it already has there:
//   - a URL already in sitemap.xml keeps its date unchanged;
//   - a URL that is new (not in sitemap.xml yet) gets today's date (YYYY-MM-DD);
//   - a URL in sitemap.xml that is no longer generated is dropped, and the build
//     prints it, so a removal is never silent.
// Order, priority and changefreq come from the templates below, as before.
//
// When a page's content really changes, bump its date explicitly:
//   node build-locales.js --touch=/de/,/en/blog/
// --touch takes a comma-separated list of site paths (or full URLs). Each listed URL
// gets today's date in this build only; the next plain build keeps that date. A path
// that is not a generated sitemap URL stops the build.
//
// An existing sitemap.xml that cannot be parsed stops the build: the dates are never
// silently restamped. With no sitemap.xml at all, every URL is new.

// Parse sitemap.xml into a Map of loc → lastmod. Throws on anything unexpected.
function parseSitemapLastmod(xml) {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  const opens = (xml.match(/<url>/g) || []).length;
  if (blocks.length === 0 || blocks.length !== opens) {
    throw new Error(`sitemap.xml: cannot parse (${opens} <url> tags, ${blocks.length} complete blocks)`);
  }
  const map = new Map();
  for (const block of blocks) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block);
    if (!loc) throw new Error('sitemap.xml: a <url> block has no <loc>');
    const mod = /<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/.exec(block);
    if (!mod) throw new Error(`sitemap.xml: no YYYY-MM-DD <lastmod> for ${loc[1]}`);
    if (map.has(loc[1])) throw new Error(`sitemap.xml: duplicate <loc> ${loc[1]}`);
    map.set(loc[1], mod[1]);
  }
  return map;
}

// Read --touch=<path,...> from the command line into a Set of full URLs.
function parseTouchArg(argv) {
  const touch = new Set();
  for (const arg of argv) {
    if (!arg.startsWith('--touch=')) throw new Error(`Unknown argument "${arg}" (only --touch=<path,...> is supported)`);
    for (const raw of arg.slice('--touch='.length).split(',')) {
      const p = raw.trim();
      if (!p) continue;
      touch.add(p.startsWith(SITE) ? p : `${SITE}${p.startsWith('/') ? '' : '/'}${p}`);
    }
  }
  return touch;
}

// existing: Map loc → lastmod from the current sitemap.xml, or null when there is none.
// touch:    Set of full URLs whose lastmod is bumped to today.
// Returns { xml, added, touched, removed } (the last three are arrays of URLs).
function buildSitemap(existing, touch) {
  const today = isoToday();
  const altLinks = LOCALES
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}"/>`)
    .join('\n');
  const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`;
  const urls = LOCALES.map(l => `  <url>
    <loc>${SITE}${l.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${altLinks}
${xDefault}
  </url>`).join('\n');

  // Cookies pages — one URL per locale, each with hreflang alternates pointing
  // at the cookies.html of every other locale (mirrors the homepage pattern).
  const cookiesAltLinks = LOCALES
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}cookies.html"/>`)
    .join('\n');
  const cookiesXDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/cookies.html"/>`;
  const cookiesUrls = LOCALES.map(l => `  <url>
    <loc>${SITE}${l.path}cookies.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
${cookiesAltLinks}
${cookiesXDefault}
  </url>`).join('\n');

  // Privacy pages — one URL per locale with reciprocal hreflang alternates.
  const privacyAltLinks = LOCALES
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}privacy.html"/>`)
    .join('\n');
  const privacyXDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/privacy.html"/>`;
  const privacyUrls = LOCALES.map(l => `  <url>
    <loc>${SITE}${l.path}privacy.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
${privacyAltLinks}
${privacyXDefault}
  </url>`).join('\n');

  const privacyWebsiteAltLinks = LOCALES
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${l.path}privacy-website.html"/>`)
    .join('\n');
  const privacyWebsiteXDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/privacy-website.html"/>`;
  const privacyWebsiteUrls = LOCALES.map(l => `  <url>
    <loc>${SITE}${l.path}privacy-website.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
${privacyWebsiteAltLinks}
${privacyWebsiteXDefault}
  </url>`).join('\n');

  // Standalone single-locale blog posts (not part of the per-locale build).
  const blogUrls = [
    'en/blog/best-free-matching-games-kids/',
    'en/blog/matching-card-games-for-kids/',
    'ro/blog/aplicatii-gratuite-copii/',
    'de/blog/kostenlose-kinderspiele/',
    'de/blog/englisch-lernen-kinder/',
    'de/blog/kinder-apps-ohne-werbung/',
    'hu/blog/ingyenes-gyerekjatekok/',
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  // Per-locale blog index hubs (not part of the per-locale build). Hubs sit below
  // the posts they link to: posts 0.7, landing 0.8, hub 0.6. Keep in sync with
  // BLOG_INDEX_LOCALES.
  const blogIndexUrls = [
    'en/blog/',
    'de/blog/',
    'ro/blog/',
    'hu/blog/',
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('\n');

  // Standalone single-locale SEO landing pages (not part of the per-locale build).
  const landingUrls = [
    'en/learn-english/',
    'de/englisch-lernen-app/',
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n');

  // App landing pages (FLI-394): one URL per locale in app.locales, with alternates for
  // exactly those locales. Registered ONLY once the app is launched; hidden or in preview
  // the pages are noindex and must not be in the sitemap (checked below).
  const appUrls = APP_LIST.filter(isLaunched).map(app => {
    const appLocales = LOCALES.filter(l => app.locales.has(l.code));
    const altLinks = appLocales
      .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${appPath(app, l)}"/>`)
      .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/${app.segment}/"/>`)
      .join('\n');
    return appLocales.map(l => `  <url>
    <loc>${SITE}${appPath(app, l)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${altLinks}
  </url>`).join('\n') + '\n';
  }).join('');

  // Standalone en+de+ro+es printables hubs (not part of the per-locale build). Same priority
  // and changefreq as landingUrls since these are landing pages, not blog content. The
  // slugs are not uniform, so they are listed explicitly. Unlike landingUrls these
  // carry xhtml:link alternates matching the hreflang the four pages declare on-page.
  // Keep in sync with PRINTABLES_LOCALES.
  const printablesAltLinks = `    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/en/printables/"/>
    <xhtml:link rel="alternate" hreflang="de" href="${SITE}/de/ausmalbilder/"/>
    <xhtml:link rel="alternate" hreflang="ro" href="${SITE}/ro/fise-de-colorat/"/>
    <xhtml:link rel="alternate" hreflang="es" href="${SITE}/es/fichas-para-colorear/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/en/printables/"/>`;
  const printablesUrls = [
    'en/printables/',
    'de/ausmalbilder/',
    'ro/fise-de-colorat/',
    'es/fichas-para-colorear/',
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${printablesAltLinks}
  </url>`).join('\n');

  // Published per-sheet printable pages (build-printables.js), with alternates for the
  // locales where each sheet is published. Below the hubs (0.8) that link to them.
  const printableSheetUrls = printableSheetSitemapEntries().map(entry => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
${entry.alternates.map(a => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`).join('\n')}
  </url>`).join('\n');

  // Single-locale utility pages (FLI-366). credits.html is one English page linked from
  // every locale's footer (the "nav.credits" label is localized, the page is not), so it
  // takes no hreflang alternates. Lowest priority: it exists to satisfy licence
  // attribution (CC BY 4.0 Twemoji, CC BY-SA 4.0 OpenMoji, OFL fonts), not to rank.
  // An app's privacy page joins this group once the app is launched (FLI-394); before
  // that it is noindex and must not be listed.
  const legalUrls = [
    'credits.html',
    ...APP_LIST.filter(isLaunched).map(app => path.relative(ROOT, app.privacy)),
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>`).join('\n');

  const stamped = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
${cookiesUrls}
${privacyUrls}
${privacyWebsiteUrls}
${blogUrls}
${blogIndexUrls}
${landingUrls}
${appUrls}${printablesUrls}
${printableSheetUrls ? `${printableSheetUrls}\n` : ''}${legalUrls}
</urlset>
`;

  // Before launch no URL of an app may be in the sitemap (its pages are noindex).
  for (const app of APP_LIST) {
    if (!isLaunched(app) && stamped.includes(`/${app.segment}/`)) {
      throw new Error(`sitemap: a /${app.segment}/ URL is registered while the app's state is '${app.state}'`);
    }
  }

  // Every template above stamps today's date; put each URL's preserved date back.
  const generated = new Set();
  const added = [];
  const touched = [];
  const xml = stamped.replace(
    /(<loc>([^<]+)<\/loc>\s*<lastmod>)[^<]*(<\/lastmod>)/g,
    (m, pre, loc, post) => {
      generated.add(loc);
      const kept = existing ? existing.get(loc) : undefined;
      if (touch.has(loc)) {
        touched.push(loc);
        return `${pre}${today}${post}`;
      }
      if (kept === undefined) {
        added.push(loc);
        return `${pre}${today}${post}`;
      }
      return `${pre}${kept}${post}`;
    }
  );
  // Guard: every <url> block must have had its lastmod handled above. A template whose
  // <loc> is not directly followed by <lastmod> would otherwise keep today's date.
  const lastmodRe = /<loc>[^<]+<\/loc>\s*<lastmod>[^<]*<\/lastmod>/;
  const urlBlocks = stamped.match(/<url>[\s\S]*?<\/url>/g) || [];
  if (urlBlocks.length !== generated.size) {
    const unmatched = urlBlocks
      .filter(block => !lastmodRe.test(block))
      .map(block => (/<loc>([^<]*)<\/loc>/.exec(block) || [, '(no <loc>)'])[1]);
    throw new Error(
      `sitemap: ${urlBlocks.length} <url> blocks but ${generated.size} distinct URLs with a preserved lastmod. ` +
      (unmatched.length
        ? `<loc> not directly followed by <lastmod>: ${unmatched.join(', ')}`
        : 'A <loc> is generated more than once.')
    );
  }
  for (const loc of touch) {
    if (!generated.has(loc)) throw new Error(`--touch: ${loc} is not a generated sitemap URL`);
  }
  const removed = existing ? [...existing.keys()].filter(loc => !generated.has(loc)) : [];
  return { xml, added, touched, removed };
}

// ============================================================
// 7) Main
// ============================================================
function main() {
  // Sitemap inputs are read first, so an unknown argument or an unparseable
  // sitemap.xml stops the build before any file is written. (A --touch path that is
  // not a generated URL is caught in buildSitemap(), before sitemap.xml is written.)
  const touch = parseTouchArg(process.argv.slice(2));
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  const existingLastmod = fs.existsSync(sitemapPath)
    ? parseSitemapLastmod(fs.readFileSync(sitemapPath, 'utf8'))
    : null;

  // stripFamily: each source is also its EN output, so drop any family blocks a visible-state
  // build left in it before anything reads it (see applyFamily).
  const source = stripFamily(fs.readFileSync(SOURCE, 'utf8'));
  const cookiesSource = fs.readFileSync(COOKIES_SOURCE, 'utf8');
  const privacySource = fs.readFileSync(PRIVACY_SOURCE, 'utf8');
  const privacyWebsiteSource = fs.readFileSync(PRIVACY_WEBSITE_SOURCE, 'utf8');
  const appSources = new Map(APP_LIST.map(app => [app, stripFamily(fs.readFileSync(app.source, 'utf8'))]));
  const { T, M } = extractLangData(source);

  // App pages: check the configuration before anything is written.
  for (const app of APP_LIST) {
    appState(app);
    const S = app.strings;
    if (!app.locales.has('en')) throw new Error(`${app.segment}: locales must contain "en" (${app.segment}/index.html is the EN page)`);
    for (const code of app.locales) {
      if (!LOCALES.some(l => l.code === code)) throw new Error(`${app.segment} locales: unknown locale "${code}"`);
      if (!S[code]) throw new Error(`${app.stringsFile} has no entry for locale "${code}"`);
      for (const n of [1, 2]) {
        const shot = `${app.shotsDir}/home${n}-${appShotLocale(app, code)}.webp`;
        if (!fs.existsSync(path.join(ROOT, shot))) throw new Error(`${app.segment} page "${code}": screenshot ${shot} is missing`);
      }
      for (const k of Object.keys(S.en)) {
        if (typeof S[code][k] !== 'string') throw new Error(`${app.stringsFile}: locale "${code}" is missing "${k}"`);
      }
    }
    // Key parity for EVERY table in the strings file (also one not in app.locales yet):
    // exactly the keys of "en" — none missing, none extra.
    for (const code of Object.keys(S)) {
      const missing = Object.keys(S.en).filter(k => typeof S[code][k] !== 'string');
      const extra = Object.keys(S[code]).filter(k => !(k in S.en));
      if (missing.length || extra.length) {
        throw new Error(`${app.stringsFile}: locale "${code}" does not match the "en" key set` +
          (missing.length ? ` — missing: ${missing.join(', ')}` : '') +
          (extra.length ? ` — extra: ${extra.join(', ')}` : ''));
      }
    }
  }
  // Key parity for family-strings.js: exactly the LOCALES, each with exactly the keys of "en".
  for (const l of LOCALES) if (!F[l.code]) throw new Error(`family-strings.js has no entry for locale "${l.code}"`);
  for (const code of Object.keys(F)) {
    if (!LOCALES.some(l => l.code === code)) throw new Error(`family-strings.js: unknown locale "${code}"`);
    const missing = Object.keys(F.en).filter(k => typeof F[code][k] !== 'string');
    const extra = Object.keys(F[code]).filter(k => !(k in F.en));
    if (missing.length || extra.length) {
      throw new Error(`family-strings.js: locale "${code}" does not match the "en" key set` +
        (missing.length ? ` — missing: ${missing.join(', ')}` : '') + (extra.length ? ` — extra: ${extra.join(', ')}` : ''));
    }
  }
  for (const app of APP_LIST.filter(isLaunched)) {
    if (!/^\d+$/.test(String(app.appStoreId || ''))) {
      throw new Error(`${app.segment} is 'launched' but appStoreId is not set: the store badges and the apple-itunes-app meta need the numeric App Store ID`);
    }
    if (!app.playPackage) {
      throw new Error(`${app.segment} is 'launched' but playPackage is not set`);
    }
  }
  // A visible app needs its family strings in every locale, or its links would read "undefined".
  for (const app of APP_LIST.filter(isVisible)) {
    const missing = ['text', 'facts', 'cta', 'nav', 'foot'].map(k => `${app.family.keys}.${k}`).filter(k => typeof F.en[k] !== 'string');
    if (missing.length) throw new Error(`${app.segment} is '${app.state}' but family-strings.js has no ${missing.join(', ')}`);
  }
  const chrome = extractSharedChrome(source);

  // Sanity check: every locale we plan to emit must exist in T.
  for (const l of LOCALES) {
    if (!T[l.code]) throw new Error(`T has no entry for locale "${l.code}"`);
    if (!M[l.code]) throw new Error(`M has no entry for locale "${l.code}"`);
    // Cookies page requires these keys in every locale.
    for (const k of ['cookies.h', 'cookies.p1', 'cookies.p2', 'cookies.p3', 'cookies.p4', 'cookies.gplink', 'cookies.fullnotice']) {
      if (typeof T[l.code][k] !== 'string') {
        throw new Error(`Locale "${l.code}" missing required cookies key "${k}"`);
      }
    }
    // Privacy pages require these keys in every locale.
    if (!P[l.code]) throw new Error(`P has no entry for locale "${l.code}"`);
    if (!PW[l.code]) throw new Error(`PW has no entry for locale "${l.code}"`);
    for (const k of ['p.title', 'p.desc']) {
      if (typeof P[l.code][k] !== 'string') {
        throw new Error(`Locale "${l.code}" missing required privacy key "${k}"`);
      }
    }
    for (const k of ['pw.title', 'pw.desc']) {
      if (typeof PW[l.code][k] !== 'string') {
        throw new Error(`Locale "${l.code}" missing required privacy-website key "${k}"`);
      }
    }
  }

  for (const locale of LOCALES) {
    const html = buildLocale(source, locale, T, M);
    const cookiesHtml = buildCookiesLocale(cookiesSource, locale, T);
    const privacyHtml = buildPrivacyLocale(privacySource, locale, T, P);
    const privacyWebsiteHtml = buildPrivacyWebsiteLocale(privacyWebsiteSource, locale, T, PW);
    let outPath, cookiesOutPath, privacyOutPath, privacyWebsiteOutPath;
    if (locale.path === '/') {
      outPath = path.join(ROOT, 'index.html');
      cookiesOutPath = path.join(ROOT, 'cookies.html');
      privacyOutPath = path.join(ROOT, 'privacy.html');
      privacyWebsiteOutPath = path.join(ROOT, 'privacy-website.html');
    } else {
      const dir = path.join(ROOT, locale.path.replace(/^\/|\/$/g, ''));
      fs.mkdirSync(dir, { recursive: true });
      outPath = path.join(dir, 'index.html');
      cookiesOutPath = path.join(dir, 'cookies.html');
      privacyOutPath = path.join(dir, 'privacy.html');
      privacyWebsiteOutPath = path.join(dir, 'privacy-website.html');
    }
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`  wrote ${path.relative(ROOT, outPath)}  (${html.length.toLocaleString()} bytes)`);
    fs.writeFileSync(cookiesOutPath, cookiesHtml, 'utf8');
    console.log(`  wrote ${path.relative(ROOT, cookiesOutPath)}  (${cookiesHtml.length.toLocaleString()} bytes)`);
    fs.writeFileSync(privacyOutPath, privacyHtml, 'utf8');
    console.log(`  wrote ${path.relative(ROOT, privacyOutPath)}  (${privacyHtml.length.toLocaleString()} bytes)`);
    fs.writeFileSync(privacyWebsiteOutPath, privacyWebsiteHtml, 'utf8');
    console.log(`  wrote ${path.relative(ROOT, privacyWebsiteOutPath)}  (${privacyWebsiteHtml.length.toLocaleString()} bytes)`);

    for (const app of APP_LIST) {
      if (!app.locales.has(locale.code)) continue;
      const appHtml = buildAppLocale(app, appSources.get(app), locale, T, M, chrome);
      const appDir = path.join(ROOT, appPath(app, locale).replace(/^\/|\/$/g, ''));
      fs.mkdirSync(appDir, { recursive: true });
      const appOutPath = path.join(appDir, 'index.html');
      fs.writeFileSync(appOutPath, appHtml, 'utf8');
      console.log(`  wrote ${path.relative(ROOT, appOutPath)}  (${appHtml.length.toLocaleString()} bytes)`);
    }
  }

  // App privacy pages: only the robots meta follows the launch gate.
  for (const app of APP_LIST) {
    const privacy = fs.readFileSync(app.privacy, 'utf8');
    const privacyOut = rewriteAppPrivacyRobots(app, privacy);
    if (privacyOut !== privacy) fs.writeFileSync(app.privacy, privacyOut, 'utf8');
    console.log(`  ${privacyOut !== privacy ? 'wrote' : 'kept '} ${path.relative(ROOT, app.privacy)}  (robots: ${isLaunched(app) ? 'index,follow' : 'noindex'})`);
  }

  // Per-sheet printable pages: only rows with published:true in printables/sheets.json, so
  // published pages fall under the drift check. buildSitemap() lists the same pages.
  console.log(`  printables: ${buildPublishedPrintables().length} published sheet page(s)`);

  const { xml: sitemap, added, touched, removed } = buildSitemap(existingLastmod, touch);
  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  console.log(`  wrote sitemap.xml (${sitemap.length.toLocaleString()} bytes)`);
  console.log(`  sitemap: ${added.length} new, ${touched.length} touched, ${removed.length} removed, lastmod kept on the rest`);
  for (const loc of added) console.log(`    new (lastmod today): ${loc}`);
  for (const loc of touched) console.log(`    touched (lastmod today): ${loc}`);
  for (const loc of removed) console.log(`    REMOVED (no longer generated): ${loc}`);

  const stateNote = {
    hidden: 'hidden (noindex, coming soon, not in sitemap, no family links)',
    preview: 'preview (noindex, coming soon, not in sitemap, family links shown)',
    launched: 'LAUNCHED (indexable, store badges, in sitemap, family links shown)',
  };
  for (const app of APP_LIST) console.log(`  ${app.segment}: ${app.locales.size} page(s), ${stateNote[app.state]}`);

  console.log(`\nDone. ${LOCALES.length} index + ${LOCALES.length} cookies + ${LOCALES.length} privacy + ${LOCALES.length} privacy-website + ${APP_LIST.map(app => `${app.locales.size} ${app.segment}`).join(' + ')} + sitemap.xml regenerated.`);
}

main();
