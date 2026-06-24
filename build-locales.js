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
  { code: 'ar', path: '/ar/', ogLocale: 'ar_SA', dir: 'rtl', isDefault: false },
];

const ROOT = __dirname;
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
// 6) Sitemap
// ============================================================
function buildSitemap() {
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

  // Standalone English-only blog posts (not part of the per-locale build).
  const blogUrls = [
    'en/blog/best-free-matching-games-kids/',
  ].map(slug => `  <url>
    <loc>${SITE}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
${cookiesUrls}
${privacyUrls}
${privacyWebsiteUrls}
${blogUrls}
</urlset>
`;
}

// ============================================================
// 7) Main
// ============================================================
function main() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const cookiesSource = fs.readFileSync(COOKIES_SOURCE, 'utf8');
  const privacySource = fs.readFileSync(PRIVACY_SOURCE, 'utf8');
  const privacyWebsiteSource = fs.readFileSync(PRIVACY_WEBSITE_SOURCE, 'utf8');
  const { T, M } = extractLangData(source);

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
  }

  const sitemap = buildSitemap();
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log(`  wrote sitemap.xml (${sitemap.length.toLocaleString()} bytes)`);

  console.log(`\nDone. ${LOCALES.length} index + ${LOCALES.length} cookies + ${LOCALES.length} privacy + ${LOCALES.length} privacy-website + sitemap.xml regenerated.`);
}

main();
