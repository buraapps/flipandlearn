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
| (inserted into every homepage, only when `ABC_LAUNCHED`) | `F` in `family-strings.js` | the Flip & Learn ABC card, header nav link and footer link on `/index.html`, `/<loc>/index.html` |
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
| `ABC_LOCALES` | `['en','hu','ro','de','fr','es','it','pt','nl','pl','tr','cs','sk','hr','sl','sv','da','no','fi','lt','lv','et','sq','ru','uk','bg','sr','el','ja','ko','ar']` (all 31) | Locales whose ABC page is emitted. `hreflang` and the sitemap list exactly these. In the page's language switcher a locale in the set links to its ABC page, any other locale to its homepage. |
| `ABC_APP_STORE_ID` | `null` | ABC's numeric App Store ID. With `ABC_LAUNCHED` true and no ID the build stops. |
| `ABC_PLAY_PACKAGE` | `com.buraapps.flipandlearnabc` | ABC's Google Play package. |

To add a locale to the ABC page: add its full string table to `abc-strings.js`, add
the code to `ABC_LOCALES`, build. The build runs a key-parity check on every table in
`abc-strings.js` (also one that is not in `ABC_LOCALES` yet): each must have exactly
the keys of `en`. A missing key or an extra key stops the build and is named in the
error.

Naming rule for the Words app on the ABC pages: always its Google Play title in the
page's language, verbatim, from the Flutter repo
(`flipandlearn_flutter/android/fastlane/metadata/android/<locale>/title.txt`), for
example en "Flip & Learn: Word Card Game", hu "Flip & Learn: Szókártyajáték", ro
"Flip & Learn: Joc de cuvinte". Where Play has no localized title, use the English
title. The name is never inflected, shortened or translated; the sentence is built
around it. "Flip & Learn", "Flip & Learn ABC", "ABC" and "Mo" stay untranslated.

Hero screenshots: a locale in `ABC_MENU_LOCALES` (the app's 18 menu languages) needs
its own `abc/shots/home1-<code>.webp` and `home2-<code>.webp`, taken on the
`ABC_Pixel_Screenshots` emulator from a committed ABC build. Any other locale reuses the
English pair (that is what the app shows on such a device), and its `abc.shot.p*.alt`
text says the menus are in English. The build stops if a needed file is missing.

Scripts: Nunito (self-hosted) covers Latin and Cyrillic. For el, ja, ko and ar the
template sets a per-locale system font stack (`html[lang="…"] body`), with Nunito
first so Latin words keep it; no external font is loaded. ja uses `line-break:strict` and
phrase-aware heading breaks (`word-break:auto-phrase`, Chrome; other browsers fall back to
normal breaking), ko `word-break:keep-all` with balanced headings. Greek eyebrows are written in capitals without accents in
`abc-strings.js`, so nothing depends on how a browser uppercases Greek. Arabic text has
no letter-spacing (it would break the joins).

Arabic is RTL: `<html dir="rtl">`, the layout mirrors through logical properties, and
the screenshot strip follows the page direction (page 1 at the right, the "next" arrow
points left, ArrowLeft = next). The screenshots themselves are not mirrored.

Release day: follow "Release day: ABC launch" below.

The standalone `abc/privacy.html` follows the same switch. The build rewrites only
its robots meta (`noindex` before launch, `index,follow` after) and registers
`/abc/privacy.html` in the sitemap's legal group once launched; every other byte of
that page is left alone.

### Flip & Learn ABC on the Words homepages (family card)

With `ABC_LAUNCHED = true`, every homepage (`/index.html`, `/<loc>/index.html`, 31) also gets:

- a "More from Flip & Learn" card after the "Made by a parent" section and before Support
  (inserted before `<section id="support">`): the ABC app icon (`abc/app-icon-96/144.webp`),
  "Flip & Learn ABC" with the A·B·C tiles in miniature, the ABC page's tagline, three facts
  (free · no ads · no in-app purchases) and a button to that locale's ABC page;
- a header nav link "Flip & Learn ABC" after Credits, shown from 1200px up only (below that
  the longest locales no longer fit the nav on one row; ru wraps at 1024px);
- a footer link "Flip & Learn ABC" before "Cookie settings", at every width.

Strings: `F` in `family-strings.js` (7 keys × 31 locales; the build checks key parity on
every run, launched or not). The markup has no `data-i18n`, so the homepage's runtime
`setLang()` leaves it in the page's own language.

Gating: `applyFamily()` adds the pieces (CSS included) only when `ABC_LAUNCHED` is true,
each wrapped in `<!-- FAMILY:NAME --> … <!-- /FAMILY:NAME -->` (CSS, NAV, CARD, FOOT).
Because `index.html` is also the EN output, the build first strips every FAMILY block from
it (`stripFamily()`), so with the flag false the homepages are byte-identical to the
unlaunched state: no markup, no CSS, no strings. The anchors (the Credits nav link,
`<section id="support">`, the Cookie settings footer link, `</head>`) must each occur
exactly once in `index.html`, or a launched build stops.

### Images made from the app icon (re-export if the app icon changes)

All of these are exported from the ABC app's icon master, `assets/icon/app_icon.png`
in the ABC repo (read with `git show <commit>:assets/icon/app_icon.png`, so only a
committed icon is ever used). If the app icon changes, re-export every one:

| File | Used for | Size |
|---|---|---|
| `abc/app-icon-96.webp`, `abc/app-icon-144.webp` | header logo on every ABC page (2× and 3× of 48 px) | 96×96, 144×144 |
| `abc/icon-32.png`, `abc/icon-180.png` | favicon and Apple touch icon of the ABC pages | 32×32, 180×180 |
| `abc/og-image.png` | share image of the ABC pages (icon on the sky, name in Nunito) | 1200×630 |

### Hero tile check (run after every ABC template change and every locale batch)

The four floating letter tiles in the hero (Ș, ß, Gy, Ñ) sit on the outer corners of
the phone. `tools/check-abc-hero.mjs` proves, for every locale in `ABC_LOCALES` at 13
widths (320, 360, 375, 390, 393, 412, 414, 428, 430, 768, 1024, 1280, 1440) and with
the float animation frozen at its start, middle and peak, that each tile

- overlaps no text, chip, button, link or the status line in the hero (0 px²),
- is not clipped by any ancestor (overflow, clip-path, contain) or by the viewport,
- does not lie on the phone screenshot (0 px²).

```bash
node build-locales.js
PLAYWRIGHT_DIR=/path/to/node_modules node tools/check-abc-hero.mjs
```

It serves the built pages itself, prints one line per width (with the smallest gap
between a tile and any hero element) and exits 1 on any failure. Playwright is not a
dependency of this repo; point `PLAYWRIGHT_DIR` at a `node_modules` folder that has
it. Options: `--locales=en,hu`, `--widths=390,1280`, and
`--crops=en:390,1280 --out=audits/abc-en-hero --tag=after` to save hero crops.

## Release day: ABC launch

Do this only once Flip & Learn ABC is live in **both** stores. All commands run in
`/Volumes/Data/BuraApps/web`; start from a clean tree (`git status` shows no change to any
generated page).

1. **Before.** `node build-locales.js` must print `sitemap: 0 new, 0 touched, 0 removed`
   and `git status` must stay clean apart from your own files. If not, stop and fix first.
2. **Flip the switch.** In `build-locales.js` set
   - `ABC_APP_STORE_ID = <the digits after "id" in the App Store URL>` (number, no quotes);
   - `ABC_LAUNCHED = true`.
   Check `ABC_PLAY_PACKAGE` is `com.buraapps.flipandlearnabc`.
3. **Build.** `node build-locales.js`. Expect:
   - `sitemap: 32 new, 0 touched, 0 removed` (31 ABC pages + `/abc/privacy.html`);
   - `abc: 31 page(s), LAUNCHED (indexable, store badges, in sitemap)`.
   What the build changed:
   - the 31 ABC pages: `noindex` → `index,follow`, the "Coming soon" line replaced by the
     App Store and Google Play badges (`ct=web-abc` on Apple, `utm_campaign=web-abc` on
     Play), the `apple-itunes-app` meta added;
   - `abc/privacy.html`: robots `index,follow` (nothing else in that file changes);
   - `sitemap.xml`: the 31 ABC URLs (with hreflang alternates) and `/abc/privacy.html`;
   - the 31 Words homepages: the family card, the header nav link (≥1200px) and the
     footer link.
4. **Verify locally.**
   ```bash
   node --check build-locales.js
   node build-locales.js | grep sitemap:          # second build: 0 new, 0 touched, 0 removed
   git diff --stat | tail -1                       # 65 files: 31 homepages, 31 ABC pages,
                                                   #   abc/privacy.html, sitemap.xml, build-locales.js
   git diff sitemap.xml | grep -c '^+    <loc>'    # 32
   git diff sitemap.xml | grep '^-' | grep -vc '^---'   # 0 (nothing removed)
   grep -l 'content="noindex' abc/index.html */abc/index.html | wc -l      # 0
   grep -l 'ct=web-abc' abc/index.html */abc/index.html | wc -l            # 31
   grep -l 'utm_campaign%3Dweb-abc' abc/index.html */abc/index.html | wc -l  # 31
   grep -o 'name="robots" content="[^"]*"' abc/privacy.html               # index,follow
   grep -l 'FAMILY:CARD' index.html */index.html | wc -l                  # 31
   PLAYWRIGHT_DIR=/path/to/node_modules node tools/check-abc-hero.mjs     # exit 0
   ```
   Open `/abc/` and `/` locally: the badges link to the real store pages, the homepage
   card's button opens `/abc/`.
5. **Commit and push** (sources and every generated file together), e.g.
   `FLI-394 step 6: Flip & Learn ABC launch`.
6. **Verify live** (after GitHub Pages has deployed; purge the Cloudflare cache if the
   old pages still show):
   ```bash
   curl -sI https://flipandlearn.app/abc/ | head -1                         # HTTP/2 200
   curl -s https://flipandlearn.app/abc/ | grep -c 'content="noindex'       # 0
   curl -s https://flipandlearn.app/de/abc/ | grep -c 'ct=web-abc'          # 1
   curl -s https://flipandlearn.app/abc/privacy.html | grep -o 'name="robots" content="[^"]*"'   # index,follow
   curl -s https://flipandlearn.app/sitemap.xml | grep -c '<loc>[^<]*/abc/'  # 32
   curl -s https://flipandlearn.app/ | grep -c 'FAMILY:CARD'                # 1
   curl -s https://flipandlearn.app/ar/ | grep -c 'href="/ar/abc/"'         # 3 (card, nav, footer)
   curl -sI "https://apps.apple.com/app/id<ABC_APP_STORE_ID>" | head -1     # 200
   curl -sI "https://play.google.com/store/apps/details?id=com.buraapps.flipandlearnabc" | head -1   # 200
   ```
   Then submit `https://flipandlearn.app/sitemap.xml` again in Google Search Console.
7. **Rollback** (if anything is wrong): set `ABC_LAUNCHED = false` (leave or reset
   `ABC_APP_STORE_ID`), run `node build-locales.js` (expect `0 new, 0 touched, 32 removed`
   and the 32 `REMOVED` lines), run it again (expect `0/0/0`), then commit and push. All
   homepages, ABC pages, `abc/privacy.html` and `sitemap.xml` return byte for byte to the
   unlaunched state (proved in the step 5 dry run).

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
