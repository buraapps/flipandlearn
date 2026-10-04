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

// ------------------------------------------------------------
// Flip & Learn ABC landing page (/abc/ and /<loc>/abc/) — FLI-394
// ------------------------------------------------------------

// The one launch switch. While false (the app is not in the stores yet) every ABC
// page — the landing pages and the standalone abc/privacy.html — carries `noindex`, shows "Coming soon…" instead of store badges, has no
// apple-itunes-app meta and is NOT in sitemap.xml (the build fails if an /abc/ URL
// gets in). Nothing on the site may link to /abc/ while it is false. Setting it to
// true switches all of that in one build: index,follow (abc/privacy.html included),
// store badges with the web-abc campaign tags, the apple-itunes-app meta and the
// sitemap entries (the ABC pages plus /abc/privacy.html). Any homepage, nav
// or footer link to the ABC page must be gated on this constant too.
const ABC_LAUNCHED = false;

// Locales whose ABC page is emitted. 'en' is the template itself and must stay in.
// A locale may be added once abc-strings.js has its full string table. The hreflang
// block and the sitemap list exactly these locales; in the page's language switcher a
// locale in this set links to its ABC page, every other locale to its homepage.
const ABC_LOCALES = new Set(['en', 'hu', 'ro']);

// ABC's numeric App Store ID (the digits after "id" in the App Store URL). null until
// the app has one. With ABC_LAUNCHED true and no ID the build stops: the badges are
// never rendered with a missing or made-up ID.
const ABC_APP_STORE_ID = null;

// ABC's Google Play package (ABC repo android/app/build.gradle.kts applicationId).
const ABC_PLAY_PACKAGE = 'com.buraapps.flipandlearnabc';

// Apple provider token: the same account-level pt= value the Words store links carry.
const APPLE_PROVIDER_TOKEN = '128736959';

const ROOT = __dirname;
const ABC_SOURCE = path.join(ROOT, 'abc', 'index.html');
const ABC_PRIVACY = path.join(ROOT, 'abc', 'privacy.html');
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

// ============================================================
// 5) Build a single locale variant
// ============================================================
function buildLocale(sourceHtml, locale, T, M) {
  let html = sourceHtml;
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewriteHead(html, locale, T, M);
  html = rewriteBadges(html, locale, T);
  html = rewriteLangButton(html, locale, M);
  html = rewritePickerActive(html, locale);
  html = rewriteBlogLink(html, locale);
  html = rewritePrintablesLink(html, locale);
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
// 5d) Flip & Learn ABC landing page (FLI-394).
//    Template: abc/index.html (also the EN output, like index.html). Strings: A in
//    abc-strings.js, merged over T[code] for the shared cookie.* / nav.* keys.
//    The template keeps permanent <!-- ABC:NAME --> … <!-- /ABC:NAME --> marker pairs;
//    the build replaces what is between them, so a block that is empty in one state
//    (no badges before launch) is never lost from the source.
// ============================================================
function abcPath(locale) {
  return `${locale.path}abc/`;
}

function fillAbcMarker(html, name, content) {
  const re = new RegExp(`<!-- ABC:${name} -->[\\s\\S]*?<!-- /ABC:${name} -->`);
  if (!re.test(html)) throw new Error(`abc/index.html: marker ABC:${name} not found`);
  return html.replace(re, () => `<!-- ABC:${name} -->\n${content}${content ? '\n' : ''}<!-- /ABC:${name} -->`);
}

// The shared chrome of the Words homepage, taken from index.html so the ABC page
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
  // Picker entries are "<flag> <name>"; the ABC page shows the name only (no emoji).
  const names = {};
  const optRe = /<a class="lang-opt[^"]*" data-lang="([a-z]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = optRe.exec(source))) names[m[1]] = m[2].trim().replace(/^\S+\s+/, '');
  for (const l of LOCALES) {
    if (!names[l.code]) throw new Error(`index.html: no language-picker entry for "${l.code}"`);
  }
  return { loader, css: cssLines.join('\n'), banner, script, beacon, names };
}

function abcLangMenu(locale, M, names) {
  const items = LOCALES.map(l => {
    const href = ABC_LOCALES.has(l.code) ? abcPath(l) : l.path;
    const active = l.code === locale.code;
    return `          <a class="lang-opt${active ? ' active' : ''}" data-lang="${l.code}" lang="${l.code}" hreflang="${l.code}" href="${href}"${active ? ' aria-current="page"' : ''} onclick="try{localStorage.setItem('flipandlearn_lang','${l.code}')}catch(e){}">${htmlEscape(names[l.code])}</a>`;
  }).join('\n');
  return `      <details class="lang">
        <summary aria-label="Change page language" data-i18n-aria="abc.lang.aria">${M[locale.code].l}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
        <div class="lang-menu">
${items}
        </div>
      </details>`;
}

// Hero call to action. Before launch: a plain status line (clock icon + "Coming
// soon…"), not a link or button and not styled like one; no store links.
// After launch: the store badges with the web-abc campaign tags, which the shared
// store_click handler reads (ct= on Apple, utm_campaign= on Play).
function abcCta(locale) {
  if (!ABC_LAUNCHED) {
    return '      <p class="soon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span data-i18n="abc.hero.soon">Coming soon to the App Store and Google Play</span></p>';
  }
  const apple = `https://apps.apple.com/app/id${ABC_APP_STORE_ID}?pt=${APPLE_PROVIDER_TOKEN}&amp;ct=web-abc&amp;mt=8`;
  const play = `https://play.google.com/store/apps/details?id=${ABC_PLAY_PACKAGE}&amp;referrer=utm_source%3Dflipandlearn.app%26utm_medium%3Dweb%26utm_campaign%3Dweb-abc`;
  return `      <div class="dl-badges">
        <a href="${apple}" target="_blank" rel="noopener"><img src="/badges/app-store-badge-${locale.code}.svg" alt="Download Flip &amp; Learn ABC on the App Store" data-i18n-alt="abc.badge.apple" width="180" height="60"></a>
        <a href="${play}" target="_blank" rel="noopener"><img src="/badges/google-play-badge-${locale.code}.png" alt="Get Flip &amp; Learn ABC on Google Play" data-i18n-alt="abc.badge.play" width="180" height="60" decoding="async"></a>
      </div>`;
}

function rewriteAbcHead(html, locale, dict) {
  const url = `${SITE}${abcPath(locale)}`;
  const titleText = dict['abc.meta.title'];
  const descText = dict['abc.meta.desc'];

  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${htmlEscape(titleText)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/,
    () => `<meta name="description" content="${attrEscape(descText)}">`);
  html = html.replace(/<meta name="robots" content="[^"]*">/,
    `<meta name="robots" content="${ABC_LAUNCHED ? 'index,follow' : 'noindex'}">`);
  html = fillAbcMarker(html, 'STORE_META',
    ABC_LAUNCHED ? `<meta name="apple-itunes-app" content="app-id=${ABC_APP_STORE_ID}">` : '');

  // Canonical + hreflang: only the locales that have an ABC page, x-default → EN.
  const en = LOCALES.find(l => l.code === 'en');
  const alternates = LOCALES.filter(l => ABC_LOCALES.has(l.code))
    .map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${abcPath(l)}">`)
    .join('\n');
  html = fillAbcMarker(html, 'HREFLANG',
    `<link rel="canonical" href="${url}">\n${alternates}\n<link rel="alternate" hreflang="x-default" href="${SITE}${abcPath(en)}">`);

  html = html.replace(/<meta property="og:title" content="[^"]*">/,
    () => `<meta property="og:title" content="${attrEscape(titleText)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/,
    () => `<meta property="og:description" content="${attrEscape(descText)}">`);
  html = html.replace(/<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${url}">`);
  html = html.replace(/<meta property="og:image:alt" content="[^"]*">/,
    () => `<meta property="og:image:alt" content="${attrEscape(dict['abc.meta.ogalt'])}">`);
  html = html.replace(/<meta property="og:locale" content="[^"]*">/,
    `<meta property="og:locale" content="${locale.ogLocale}">`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*">/,
    () => `<meta name="twitter:title" content="${attrEscape(titleText)}">`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*">/,
    () => `<meta name="twitter:description" content="${attrEscape(descText)}">`);
  return html;
}

// Links from the ABC page to the rest of the site, per locale. EN always keeps every
// link, so the template (the EN output) never loses one.
function rewriteAbcLinks(html, locale) {
  const setHref = (id, href) => {
    const re = new RegExp(`(<a\\b[^>]*\\bid="${id}"[^>]*\\bhref=")[^"]*(")|(<a\\b[^>]*\\bhref=")[^"]*("[^>]*\\bid="${id}")`);
    if (!re.test(html)) throw new Error(`abc/index.html: link #${id} not found`);
    html = html.replace(re, (m, a, b, c, d) => (a ? `${a}${href}${b}` : `${c}${href}${d}`));
  };
  const dropLink = id => {
    html = html.replace(new RegExp(`\\s*<a\\b[^>]*\\bid="${id}"[^>]*>[^<]*<\\/a>`), '');
  };
  setHref('abcWordsCta', locale.path);
  setHref('abcFootWords', locale.path);
  if (BLOG_INDEX_LOCALES.has(locale.code)) setHref('abcFootBlog', `/${locale.code}/blog/`);
  else dropLink('abcFootBlog');
  if (PRINTABLES_LOCALES.has(locale.code)) {
    setHref('abcFootPrint', PRINTABLES_PATHS[locale.code]);
    setHref('abcPrintCta', PRINTABLES_PATHS[locale.code]);
  } else {
    dropLink('abcFootPrint');
    html = html.replace(/<!-- ABC:PRINTABLES_BEGIN -->[\s\S]*?<!-- ABC:PRINTABLES_END -->\s*/, '');
  }
  return html;
}

// abc/privacy.html is a standalone, hand-written page. The build changes exactly one
// thing in it: the robots meta follows ABC_LAUNCHED (noindex before launch,
// index,follow after). Every other byte stays as it is.
function rewriteAbcPrivacyRobots(html) {
  const re = /<meta name="robots" content="[^"]*">/;
  if (!re.test(html)) throw new Error('abc/privacy.html: robots meta not found');
  return html.replace(re, `<meta name="robots" content="${ABC_LAUNCHED ? 'index,follow' : 'noindex'}">`);
}

// alt="" from a data-i18n-alt key (the store badges).
function applyDataI18nAlt(html, dict) {
  return html.replace(/<img\b([^>]*?\bdata-i18n-alt="([^"]+)"[^>]*)>/g, (match, attrs, key) => {
    const v = dict[key];
    if (typeof v !== 'string') return match;
    return `<img${attrs.replace(/\balt="[^"]*"/, () => `alt="${attrEscape(v)}"`)}>`;
  });
}

function buildAbcLocale(sourceHtml, locale, T, M, chrome) {
  const merged = Object.assign({}, T[locale.code] || {}, A[locale.code] || {});
  const wrap = { [locale.code]: merged };
  let html = sourceHtml;
  html = rewriteHtmlTag(html, locale);
  html = rewriteBodyTag(html, locale);
  html = rewriteAbcHead(html, locale, merged);
  html = fillAbcMarker(html, 'CONSENT_HEAD', `${chrome.loader}\n<style>\n${chrome.css}\n</style>`);
  html = fillAbcMarker(html, 'LANG', abcLangMenu(locale, M, chrome.names));
  html = fillAbcMarker(html, 'CTA', abcCta(locale));
  // The banner's "Learn more" link is relative on the homepage; from /abc/ it has to
  // point at this locale's cookies page explicitly.
  const banner = chrome.banner.replace('href="cookies.html"', `href="${locale.path}cookies.html"`);
  html = fillAbcMarker(html, 'CONSENT_BODY', `${banner}\n<script>\n${chrome.script}\n</script>\n\n${chrome.beacon}`);
  html = rewriteAbcLinks(html, locale);
  // Hero phone: this locale's screenshots of the app's two Home pages.
  html = html.replace(/\/abc\/shots\/home([12])-en\.webp/g, `/abc/shots/home$1-${locale.code}.webp`);
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

  // Flip & Learn ABC landing pages (FLI-394): one URL per locale in ABC_LOCALES, with
  // alternates for exactly those locales. Registered ONLY once ABC_LAUNCHED is true;
  // before launch the pages are noindex and must not be in the sitemap (checked below).
  const abcLocales = LOCALES.filter(l => ABC_LOCALES.has(l.code));
  const abcAltLinks = abcLocales
    .map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${abcPath(l)}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/abc/"/>`)
    .join('\n');
  const abcUrls = !ABC_LAUNCHED ? '' : abcLocales.map(l => `  <url>
    <loc>${SITE}${abcPath(l)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${abcAltLinks}
  </url>`).join('\n') + '\n';

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

  // Single-locale utility pages (FLI-366). credits.html is one English page linked from
  // every locale's footer (the "nav.credits" label is localized, the page is not), so it
  // takes no hreflang alternates. Lowest priority: it exists to satisfy licence
  // attribution (CC BY 4.0 Twemoji, CC BY-SA 4.0 OpenMoji, OFL fonts), not to rank.
  // abc/privacy.html joins this group once ABC_LAUNCHED is true (FLI-394); before
  // launch it is noindex and must not be listed.
  const legalUrls = [
    'credits.html',
    ...(ABC_LAUNCHED ? ['abc/privacy.html'] : []),
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
${abcUrls}${printablesUrls}
${legalUrls}
</urlset>
`;

  // Before launch no ABC URL may be in the sitemap (the pages are noindex and unlinked).
  if (!ABC_LAUNCHED && stamped.includes('/abc/')) {
    throw new Error('sitemap: an /abc/ URL is registered while ABC_LAUNCHED is false');
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

  const source = fs.readFileSync(SOURCE, 'utf8');
  const cookiesSource = fs.readFileSync(COOKIES_SOURCE, 'utf8');
  const privacySource = fs.readFileSync(PRIVACY_SOURCE, 'utf8');
  const privacyWebsiteSource = fs.readFileSync(PRIVACY_WEBSITE_SOURCE, 'utf8');
  const abcSource = fs.readFileSync(ABC_SOURCE, 'utf8');
  const { T, M } = extractLangData(source);

  // ABC page: check the configuration before anything is written.
  if (!ABC_LOCALES.has('en')) throw new Error('ABC_LOCALES must contain "en" (abc/index.html is the EN page)');
  for (const code of ABC_LOCALES) {
    if (!LOCALES.some(l => l.code === code)) throw new Error(`ABC_LOCALES: unknown locale "${code}"`);
    if (!A[code]) throw new Error(`abc-strings.js has no entry for locale "${code}"`);
    for (const n of [1, 2]) {
      const shot = path.join(ROOT, 'abc', 'shots', `home${n}-${code}.webp`);
      if (!fs.existsSync(shot)) throw new Error(`ABC page "${code}": screenshot abc/shots/home${n}-${code}.webp is missing`);
    }
    for (const k of Object.keys(A.en)) {
      if (typeof A[code][k] !== 'string') throw new Error(`abc-strings.js: locale "${code}" is missing "${k}"`);
    }
  }
  // Key parity for EVERY table in abc-strings.js (also one not in ABC_LOCALES yet):
  // exactly the keys of "en" — none missing, none extra.
  for (const code of Object.keys(A)) {
    const missing = Object.keys(A.en).filter(k => typeof A[code][k] !== 'string');
    const extra = Object.keys(A[code]).filter(k => !(k in A.en));
    if (missing.length || extra.length) {
      throw new Error(`abc-strings.js: locale "${code}" does not match the "en" key set` +
        (missing.length ? ` — missing: ${missing.join(', ')}` : '') +
        (extra.length ? ` — extra: ${extra.join(', ')}` : ''));
    }
  }
  if (ABC_LAUNCHED && !/^\d+$/.test(String(ABC_APP_STORE_ID || ''))) {
    throw new Error('ABC_LAUNCHED is true but ABC_APP_STORE_ID is not set: the store badges and the apple-itunes-app meta need the numeric App Store ID');
  }
  if (ABC_LAUNCHED && !ABC_PLAY_PACKAGE) {
    throw new Error('ABC_LAUNCHED is true but ABC_PLAY_PACKAGE is not set');
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

    if (ABC_LOCALES.has(locale.code)) {
      const abcHtml = buildAbcLocale(abcSource, locale, T, M, chrome);
      const abcDir = path.join(ROOT, abcPath(locale).replace(/^\/|\/$/g, ''));
      fs.mkdirSync(abcDir, { recursive: true });
      const abcOutPath = path.join(abcDir, 'index.html');
      fs.writeFileSync(abcOutPath, abcHtml, 'utf8');
      console.log(`  wrote ${path.relative(ROOT, abcOutPath)}  (${abcHtml.length.toLocaleString()} bytes)`);
    }
  }

  // ABC privacy page: only its robots meta follows the launch switch.
  const abcPrivacy = fs.readFileSync(ABC_PRIVACY, 'utf8');
  const abcPrivacyOut = rewriteAbcPrivacyRobots(abcPrivacy);
  if (abcPrivacyOut !== abcPrivacy) fs.writeFileSync(ABC_PRIVACY, abcPrivacyOut, 'utf8');
  console.log(`  ${abcPrivacyOut !== abcPrivacy ? 'wrote' : 'kept '} abc/privacy.html  (robots: ${ABC_LAUNCHED ? 'index,follow' : 'noindex'})`);

  const { xml: sitemap, added, touched, removed } = buildSitemap(existingLastmod, touch);
  fs.writeFileSync(sitemapPath, sitemap, 'utf8');
  console.log(`  wrote sitemap.xml (${sitemap.length.toLocaleString()} bytes)`);
  console.log(`  sitemap: ${added.length} new, ${touched.length} touched, ${removed.length} removed, lastmod kept on the rest`);
  for (const loc of added) console.log(`    new (lastmod today): ${loc}`);
  for (const loc of touched) console.log(`    touched (lastmod today): ${loc}`);
  for (const loc of removed) console.log(`    REMOVED (no longer generated): ${loc}`);

  console.log(`  abc: ${ABC_LOCALES.size} page(s), ${ABC_LAUNCHED ? 'LAUNCHED (indexable, store badges, in sitemap)' : 'not launched (noindex, coming soon, not in sitemap)'}`);

  console.log(`\nDone. ${LOCALES.length} index + ${LOCALES.length} cookies + ${LOCALES.length} privacy + ${LOCALES.length} privacy-website + ${ABC_LOCALES.size} abc + sitemap.xml regenerated.`);
}

main();
