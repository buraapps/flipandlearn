# build-locales.js

Reusable pre-render script that turns the site's source templates into crawlable
per-locale pages plus `sitemap.xml`. The site has **31 locales** (the `LOCALES` array
at the top of the script).

## Why this exists

The site is a static SPA whose locale was originally switched entirely in client-side
JavaScript (`setLang()` at the bottom of `index.html`). Googlebot only indexes what the
HTML response contains, so the non-English locales were invisible in search. This
script emits real, pre-translated HTML at distinct URLs (`/`, `/de/`, `/fr/`, …) so
every locale is crawlable while the existing JS picker keeps working as a progressive
enhancement.

## What it produces

| Source (also the English output) | Strings | Output per locale |
|---|---|---|
| `index.html` | `T` and `M`, inline in `index.html` | `/index.html`, `/<loc>/index.html` (31) |
| `cookies.html` | `T` | `/cookies.html`, `/<loc>/cookies.html` (31) |
| `privacy.html` | `P` in `privacy-strings.js` | `/privacy.html`, `/<loc>/privacy.html` (31) |
| `privacy-website.html` | `PW` in `privacy-strings.js` | `/privacy-website.html`, `/<loc>/privacy-website.html` (31) |
| `abc/index.html` | `A` in `abc-strings.js` | `/abc/index.html`, `/<loc>/abc/index.html` (only the locales in `ABC_LOCALES`) |
| — | — | `/sitemap.xml` |

Every source template is also its own English output: the build rewrites it in place.
A build of an unchanged tree therefore changes nothing (the script is idempotent), and
that is what the "Build drift" GitHub workflow checks.

Each generated homepage has:
- `<html lang="xx" [dir="rtl"]>` set at build time (no FOUC, no JS required)
- localized `<title>`, `<meta description>`, `og:*`, `twitter:*`
- self-referencing `<link rel="canonical">` and a full `hreflang` block (31 locales +
  `x-default`)
- localized App Store / Play Store badge images and alt text
- all `data-i18n` body text pre-translated
- `<script>window.__pageLocale="xx"</script>` so the runtime knows which locale it was
  rendered for

Not generated (hand-written, standalone): the blog, the SEO landing pages, the
printables hubs, `credits.html` and `abc/privacy.html`.

## How to run

```bash
cd /Volumes/Data/BuraApps/web
node build-locales.js
```

No dependencies. Plain Node (CI uses Node 24). Commit the sources and every generated
file together.

Re-run **every time** you touch a source template, a string table, or the
configuration at the top of `build-locales.js`.

## Sitemap: `lastmod` is preserved

The build reads the committed `sitemap.xml` before regenerating it:

- a URL already in the sitemap **keeps its `<lastmod>`**;
- a URL that is new gets today's date;
- a URL that is no longer generated is dropped, and the build prints it as `REMOVED`;
- order, priority and changefreq come from the templates in `buildSitemap()`.

So a plain build no longer touches the sitemap, and there is nothing to restore
afterwards. The build prints a summary line, for example
`sitemap: 0 new, 0 touched, 0 removed, lastmod kept on the rest`.

When a page's content really changes, bump its date explicitly:

```bash
node build-locales.js --touch=/de/,/en/blog/
```

`--touch` takes a comma-separated list of site paths (or full URLs). Each listed URL
gets today's date in that build only; the next plain build keeps it.

The build **stops with an error** (it never falls back to restamping) when:
- the existing `sitemap.xml` cannot be parsed, has a duplicate `<loc>`, or has a
  missing or malformed `<lastmod>`;
- an argument other than `--touch=…` is given, or a `--touch` path is not a generated
  sitemap URL;
- a `<url>` template does not have `<lastmod>` directly after `<loc>`;
- an `/abc/` URL is in the sitemap while `ABC_LAUNCHED` is false.

## Flip & Learn ABC page

Template `abc/index.html`, strings `abc-strings.js`. The page has its own design
(the ABC app's colour tokens, self-hosted Nunito from `/fonts/nunito/`) and takes the
shared chrome from `index.html` at build time: the consent-gated Google Ads loader,
the cookie banner (CSS, markup, controller), the `store_click` handler, the
Cloudflare Web Analytics beacon and the language names of the picker. If any of
those cannot be found in `index.html`, the build stops.

The template keeps permanent marker pairs, `<!-- ABC:NAME -->` … `<!-- /ABC:NAME -->`
(`STORE_META`, `HREFLANG`, `CONSENT_HEAD`, `LANG`, `CTA`, `CONSENT_BODY`). The build
replaces what is between them. Never delete a marker: because the template is also
the English output, a block that is empty in one state would otherwise be lost.

Four constants at the top of `build-locales.js` control it:

| Constant | Now | Meaning |
|---|---|---|
| `ABC_LAUNCHED` | `false` | The launch switch. `false`: `noindex`, "Coming soon to the App Store and Google Play" with no store links, no `apple-itunes-app` meta, no sitemap entry, and nothing on the site may link to `/abc/`. `true`: `index,follow` (also on `abc/privacy.html`), store badges with `ct=web-abc` / `utm_campaign=web-abc`, the `apple-itunes-app` meta, and the sitemap entries (ABC pages plus `/abc/privacy.html`). |
| `ABC_LOCALES` | `['en']` | Locales whose ABC page is emitted. `hreflang` and the sitemap list exactly these. In the page's language switcher a locale in the set links to its ABC page, any other locale to its homepage. |
| `ABC_APP_STORE_ID` | `null` | ABC's numeric App Store ID. With `ABC_LAUNCHED` true and no ID the build stops. |
| `ABC_PLAY_PACKAGE` | `com.buraapps.flipandlearnabc` | ABC's Google Play package. |

To add a locale to the ABC page: add its full string table to `abc-strings.js` (same
keys as `en`; the build stops on a missing key), add the code to `ABC_LOCALES`, build.

Release day: set `ABC_APP_STORE_ID`, set `ABC_LAUNCHED = true`, build, commit.

The standalone `abc/privacy.html` follows the same switch. The build rewrites only
its robots meta (`noindex` before launch, `index,follow` after) and registers
`/abc/privacy.html` in the sitemap's legal group once launched; every other byte of
that page is left alone.

## How to add a new site locale

1. **Translate.** Add a complete locale entry to the `T` dictionary inside
   `index.html` (between the `/* __LANG_DATA_BEGIN__ */` and `/* __LANG_DATA_END__ */`
   markers). Mirror the key set used by `en`. Required at minimum: `b1`, `b2`,
   `hero.sub` (used to derive `<title>` and `<meta description>`), the `cookies.*`
   keys, plus all the `data-i18n*` keys referenced in markup.
2. **Add the picker entry.** Add a flag + label entry to the `M` dictionary inside
   `index.html` (same script block). Example: `nl:{f:"🇳🇱",l:"NL"}`.
3. **Add the picker link.** In the `<div class="lang-menu" id="langMenu">` block of
   `index.html`, add a picker anchor mirroring the others. The ABC page takes its
   language names from these anchors.
4. **Add the privacy strings.** Add the locale to `P` and `PW` in `privacy-strings.js`.
5. **Add badge assets.** Drop `app-store-badge-xx.svg` and `google-play-badge-xx.png`
   into `badges/`. The build picks them up by locale code.
6. **Register the locale.** Add an entry to the `LOCALES` array in `build-locales.js`:
   ```js
   { code: 'nl', path: '/nl/', ogLocale: 'nl_NL', dir: 'ltr', isDefault: false },
   ```
7. **Update the FLI-61 IIFE.** In the inline script near the bottom of `index.html`
   that declares `const supported = ['en','de',...]`, add the new code so client-side
   browser-language detection on the root will pick it up.
8. **Run** `node build-locales.js`. The new pages are emitted and the sitemap gains
   the new URLs (reported as `new`) with today's date.

## How locale detection works at runtime (homepage)

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

The ABC page has no runtime language swap: each locale is a static page, and its
language switcher is plain links (which also store the choice for the homepage).

## Caveats

- `setLang()` (the runtime DOM swap) still works on every homepage. A returning-visitor
  scenario where saved-pref differs from URL (`/de/` page + `localStorage='fr'`) keeps
  the in-place DOM swap so the visitor sees French — URL/content mismatch in this edge
  case is acceptable.
- JSON-LD schema (`SoftwareApplication`, `FAQPage`) is **not** localized. The body FAQ
  text is translated, but Google's FAQ rich results draw from the JSON-LD, which stays
  in English on every page.
- "Today" in the sitemap is the UTC date.
