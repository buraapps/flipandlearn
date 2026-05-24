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
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
  <url>
    <loc>${SITE}/privacy.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${SITE}/privacy-website.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
`;
}

// ============================================================
// 7) Main
// ============================================================
function main() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const { T, M } = extractLangData(source);

  // Sanity check: every locale we plan to emit must exist in T.
  for (const l of LOCALES) {
    if (!T[l.code]) throw new Error(`T has no entry for locale "${l.code}"`);
    if (!M[l.code]) throw new Error(`M has no entry for locale "${l.code}"`);
  }

  for (const locale of LOCALES) {
    const html = buildLocale(source, locale, T, M);
    let outPath;
    if (locale.path === '/') {
      outPath = path.join(ROOT, 'index.html');
    } else {
      const dir = path.join(ROOT, locale.path.replace(/^\/|\/$/g, ''));
      fs.mkdirSync(dir, { recursive: true });
      outPath = path.join(dir, 'index.html');
    }
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`  wrote ${path.relative(ROOT, outPath)}  (${html.length.toLocaleString()} bytes)`);
  }

  const sitemap = buildSitemap();
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log(`  wrote sitemap.xml (${sitemap.length.toLocaleString()} bytes)`);

  console.log(`\nDone. ${LOCALES.length} locale pages + sitemap.xml regenerated.`);
}

main();
