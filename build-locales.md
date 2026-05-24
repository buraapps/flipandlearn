# build-locales.js

Reusable pre-render script that turns `index.html` (the single source of truth) into
9 crawlable per-locale variants plus a fresh `sitemap.xml`.

## Why this exists

The site is a static SPA whose locale was originally switched entirely in client-side
JavaScript (`setLang()` at the bottom of `index.html`). Googlebot only indexes what the
HTML response contains, so all 8 non-English locales were invisible in search. This
script emits real, pre-translated HTML at distinct URLs (`/`, `/de/`, `/fr/`, …) so
every locale is crawlable while the existing JS picker keeps working as a progressive
enhancement.

## What it produces

```
/index.html            English root (canonical for en + x-default)
/de/index.html         German
/fr/index.html         French
/es/index.html         Spanish
/it/index.html         Italian
/pt/index.html         Portuguese (European — pt_PT)
/ro/index.html         Romanian
/hu/index.html         Hungarian
/ar/index.html         Arabic (RTL: <html dir="rtl">, <body class="rtl">)
/sitemap.xml           9 URLs, each with reciprocal hreflang alternates + x-default
```

Each generated page has:
- `<html lang="xx" [dir="rtl"]>` set server-side (no FOUC, no JS required)
- localized `<title>`, `<meta description>`, `og:title`, `og:description`, `og:locale`, `twitter:title`, `twitter:description`
- self-referencing `<link rel="canonical">`
- full `hreflang` block: 9 locales + `x-default` pointing to all 9 + root
- localized App Store / Play Store badge SVGs and alt text
- all `data-i18n` body text pre-translated (~123 elements per page)
- `<script>window.__pageLocale="xx"</script>` so the runtime can tell which locale
  it was rendered for

## How to run

```bash
cd /Volumes/Data/BuraApps/web
node build-locales.js
```

No dependencies. Plain Node (tested on v24, works on any modern Node).
The script is idempotent — re-running on unchanged source produces byte-identical output.

## When to run it

Re-run **every time** you touch:
- text in the `T` translation dictionary inside `index.html`
- any markup in `index.html` (sections, classes, badges, structure)
- the locale list at the top of `build-locales.js`

Then commit both `index.html` and all `*/index.html` outputs together so the live
site stays consistent.

## How to add a new locale

1. **Translate.** Add a complete locale entry to the `T` dictionary inside
   `index.html` (between the `/* __LANG_DATA_BEGIN__ */` and `/* __LANG_DATA_END__ */`
   markers). Mirror the key set used by `en`. Required keys at minimum: `b1`, `b2`,
   `hero.sub` (used to derive `<title>` and `<meta description>`), plus all the
   `data-i18n*` keys referenced in markup. The simplest way: copy the `en:` block
   and translate value-by-value.

2. **Add the picker entry.** Add a flag + label entry to the `M` dictionary inside
   `index.html` (same script block). Example: `nl:{f:"🇳🇱",l:"NL"}`.

3. **Add the picker link.** In the `<div class="lang-menu" id="langMenu">` block
   (around line 330 of `index.html`), add a new picker anchor mirroring the others:
   ```html
   <a class="lang-opt" data-lang="nl" href="/nl/"
      onclick="try{localStorage.setItem('flipandlearn_lang','nl')}catch(e){}">🇳🇱 Nederlands</a>
   ```

4. **Add badge assets.** Drop `app-store-badge-nl.svg` and `google-play-badge-nl.png`
   into `badges/`. The build script picks them up automatically via the locale code.

5. **Register the locale in the build script.** Add an entry to the `LOCALES` array
   in `build-locales.js`:
   ```js
   { code: 'nl', path: '/nl/', ogLocale: 'nl_NL', dir: 'ltr', isDefault: false },
   ```

6. **Update the FLI-61 IIFE.** In the inline script near the bottom of `index.html`
   that declares `const supported = ['en','de',...]`, add the new code so client-side
   browser-language detection on the root will pick it up.

7. **Run.** `node build-locales.js` — the new `/nl/index.html` will be emitted and
   the sitemap regenerated with the new alternate URL across all locales.

## How locale detection works at runtime

The pre-rendered HTML always serves the correct locale for its URL — crawlers and
no-JS users see translated content directly. After the page loads, an IIFE near the
bottom of `index.html` decides whether to swap the language client-side:

- **Returning visitor with explicit picker choice** (localStorage has a supported
  language code): always honored — calls `setLang(saved)`. Works on any URL.
- **First-time visitor on `/`** (English root, no saved pref): reads
  `navigator.languages`, picks the first supported non-English code, and swaps the
  DOM via `setLang(code)`. The URL stays `/` — this is intentional, since the auto-
  detected swap is a guess.
- **First-time visitor on a per-locale URL** like `/de/` (no saved pref): does
  nothing. The page already renders the right locale for the URL the visitor
  followed.

The picker entries are real `<a href="/xx/">` anchors that also write to
`localStorage` on click, so the next visit lands directly on the chosen locale's
pre-rendered URL without an extra JS swap.

## Caveats

- `setLang()` (the runtime DOM swap) still works on every page. A picker click on
  `/de/` writes localStorage and navigates to `/fr/`, where the pre-rendered French
  page loads. A returning-visitor scenario where saved-pref differs from URL
  (`/de/` page + `localStorage='fr'`) keeps the existing in-place DOM swap so the
  visitor sees French — URL/content mismatch in this edge case is acceptable.
- JSON-LD schema (`SoftwareApplication`, `FAQPage`) is **not** localized — out of
  scope for this script. The body FAQ text is translated, but Google's FAQ rich
  results draw from the JSON-LD, which stays in English on every page.
- `privacy.html` and `privacy-website.html` are untouched — English only, no
  hreflang. Localizing these is a separate task.
