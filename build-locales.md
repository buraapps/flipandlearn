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
| `abc/index.html` | `A` in `abc-strings.js` | `/abc/index.html`, `/<loc>/abc/index.html` (31, the locales in `APPS.abc.locales`) |
| `123/index.html` | `N` in `123-strings.js` | `/123/index.html`, `/<loc>/123/index.html` (31, the locales in `APPS.num.locales`) |
| (inserted into the homepages and app pages, for apps at `preview` or `launched`) | `F` in `family-strings.js` | the family cards, header nav link and footer links |
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
printables hubs, `credits.html`, `abc/privacy.html` and `123/privacy.html` (of the two privacy
pages the build rewrites only the robots meta).

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
- a URL under an app's path (`/abc/`, `/123/`) is in the sitemap while that app is not `launched`;
- an app has an invalid `state`, or is `launched` without a numeric `appStoreId` or a `playPackage`.

## App pages: Flip & Learn ABC and Flip & Learn 123

Two apps have their own section on the site, each an entry in `APPS` at the top of
`build-locales.js`: `APPS.abc` (`/abc/`) and `APPS.num` (`/123/`). Each has its template,
its string table and its 31 locale pages, and each launches on its own.

| | ABC | 123 |
|---|---|---|
| Template (also the EN output) | `abc/index.html` | `123/index.html` |
| Strings | `A` in `abc-strings.js` | `N` in `123-strings.js` |
| Template markers | `<!-- ABC:NAME -->` | `<!-- NUM:NAME -->` |
| Link ids, string keys | `abc…`, `abc.*` | `num…`, `num.*` |
| Privacy page (hand-written, 7 languages) | `abc/privacy.html` | `123/privacy.html` |
| Screenshots | `abc/shots/` | `123/shots/` |
| Campaign tag (per locale: `ct=` on Apple, `utm_campaign=` on Play) | `web-abc-<locale>` (`/abc/` → `web-abc-en`) | `web-123-<locale>` (`/123/` → `web-123-en`) |
| App Store ID | `6822385987` | `6826912900` |
| Google Play package | `com.buraapps.flipandlearnabc` | `com.buraapps.flipandlearn_numbers` |
| Locales | all 31 | all 31 |
| Menu languages (own Home screenshots) | 18 | 17 (ABC's without Portuguese) |
| Family keys, accent | `family.*`, `#2A78C8` | `family.num.*`, `#C44618` |

Each page has its app's own design (colour tokens, self-hosted Nunito from
`/fonts/nunito/`) and takes the shared chrome from `index.html` at build time: the
consent-gated Google Ads loader, the cookie banner (CSS, markup, controller), the
`store_click` handler, the Cloudflare Web Analytics beacon and the language names of the
picker. If any of those cannot be found in `index.html`, the build stops.

The templates keep permanent marker pairs (`STORE_META`, `HREFLANG`, `CONSENT_HEAD`, `LANG`,
`CTA`, `CONSENT_BODY`, and on the ABC template `JSONLD`; `PRINTABLES_BEGIN` and `PRINTABLES_END`
mark the block a locale without a printables hub loses). The build replaces what is between them. Never delete a marker:
because a template is also the English output, a block that is empty in one state would
otherwise be lost.

`state` is each app's launch gate, one of three values (any other value stops the build).
ABC is `launched` (since 2026-11-08, FLI-672); 123 is at `preview`:

| `state` | Landing pages and privacy page | Store badges, `apple-itunes-app` meta | `sitemap.xml` | Family links to the app |
|---|---|---|---|---|
| `hidden` | `noindex`, "Coming soon" | none | not listed | none: no page on the site links to it |
| `preview` | as `hidden` | none | not listed | shown |
| `launched` | `index,follow` | badges with the app's per-locale `ct=` / `utm_campaign=` tag (`web-abc-de`), the meta, and the JSON-LD block on an app that has one (ABC) | 31 landing pages plus the privacy page | shown |

`preview` deliberately links to the page of a not-yet-released app from live pages. This
reverses the old rule "nothing may link to `/abc/` before launch"; the page itself stays
noindex with "Coming soon".

`hidden` and `preview` do not use `appStoreId` or `playPackage`. `launched` without a numeric
`appStoreId` or without a `playPackage` stops the build, so badges are never rendered with a
missing or made-up ID.

`locales` lists the pages an app emits; `hreflang` and the sitemap list exactly these. In the
page's language switcher a locale in the set links to its app page, any other locale to its
homepage.

To add a locale to an app: add its full string table to that app's strings file, add the
code to the app's `locales`, build. The build runs a key-parity check on every table (also
one that is not in `locales` yet): each must have exactly the keys of `en`. A missing or
extra key stops the build and is named in the error.

Naming rule for the Words app on the app pages: always its Google Play title in the page's
language, verbatim, from the Flutter repo
(`flipandlearn_flutter/android/fastlane/metadata/android/<locale>/title.txt`), for
example en "Flip & Learn: Kids Vocabulary", hu "Flip & Learn: Gyerek szókincs", ro
"Flip & Learn: Vocabular copii". Where Play has no localized title, use the English
title. The name is never inflected, shortened or translated; the sentence is built
around it. Where a sentence needs a case the title cannot take, a classifier noun carries
it and the title stays nominative ("Aplikace Flip & Learn: Dětská slovíčka je …",
"Flip & Learn: Çocuk Kelimeleri uygulamasını keşfet"). "Flip & Learn", "Flip & Learn ABC", "Flip & Learn 123", "ABC", "123" and "Mo" stay
untranslated.

Hero screenshots: a locale in the app's `menuLocales` needs its own
`<shotsDir>/home1-<code>.webp` and `home2-<code>.webp`, taken from a committed build of that
app (ABC on the `ABC_Pixel_Screenshots` emulator). Any other locale reuses the English pair
(that is what the app shows on such a device), and its `*.shot.p*.alt` text says the menus are
in English. The build stops if a needed file is missing.

The 123 page's print button goes to the numbers section of the printables hub
(`printablesAnchors`, en, de, ro, es); the ABC button and every footer link go to the hub root.

Scripts: Nunito (self-hosted) covers Latin and Cyrillic. For el, ja, ko and ar the
templates set a per-locale system font stack (`html[lang="…"] body`), with Nunito
first so Latin words keep it; no external font is loaded. ja uses `line-break:strict` and
phrase-aware heading breaks (`word-break:auto-phrase`, Chrome; other browsers fall back to
normal breaking), ko `word-break:keep-all` with balanced headings. Greek eyebrows are written
in capitals without accents in the strings files, so nothing depends on how a browser
uppercases Greek. Arabic text has no letter-spacing (it would break the joins).

Arabic is RTL: `<html dir="rtl">`, the layout mirrors through logical properties, and
the screenshot strip follows the page direction (page 1 at the right, the "next" arrow
points left, ArrowLeft = next). The screenshots themselves are not mirrored.

Release day: follow "Release day runbooks" below.

The standalone privacy pages follow the same switch. The build rewrites only their robots
meta (`noindex` while `hidden` or `preview`, `index,follow` when `launched`) and registers
`/abc/privacy.html` or `/123/privacy.html` in the sitemap's legal group once launched; every
other byte of those pages is left alone.

### Family links between the apps

`applyFamily()` connects the Words homepages, the ABC pages and the 123 pages. A page's
siblings are the apps that are `preview` or `launched`, minus the page's own app. So every
Words homepage can have two siblings, and an app page at most one. For each sibling a page gets:

- a "More from Flip & Learn" card with the app's icon, its name with the mini tiles, its
  tagline, three facts (free · no ads · no in-app purchases) and a button to the same locale's
  app page. On the homepages the cards come after "Made by a parent" and before Support; on
  an app page, before the printables block;
- a footer link at every width.

The header nav gets one link:

- one sibling: a direct link to that app, labelled with its name;
- two or more siblings: one "More apps" link (`family.more`) to the cards, `#more-apps`
  (`scroll-margin-top:56px`, so the jump lands below the sticky nav).

The nav link shows from 1200px on the homepages and from 1024px on the app pages. Below
those widths the longest locales no longer fit the nav on one row.

| Words homepage | ABC page | 123 page |
|---|---|---|
| both visible: "More apps", 2 cards, 2 footer links | 123 visible: link, card, footer link to 123 | ABC visible: link, card, footer link to ABC |
| one visible: direct link, 1 card, 1 footer link | 123 hidden: no family block | ABC hidden: no family block |
| neither: no family block | | |

A sibling without a page in the visitor's locale falls back to its English page.

Strings: `F` in `family-strings.js`, 13 keys × 31 locales. The build checks key parity on every
run, whatever the states.

| Keys | Content |
|---|---|
| `family.eyebrow`, `family.new` | Card eyebrow and "New" badge, shared by both cards |
| `family.text`, `.facts`, `.cta`, `.nav`, `.foot` | ABC's card line, facts, button, nav link, footer link |
| `family.num.text`, `.facts`, `.cta`, `.nav`, `.foot` | The same for 123. `.text` is `num.meta.title` after the dash, shaped like `family.text` |
| `family.more` | "More apps" |

The markup has no `data-i18n`, so the homepage's runtime `setLang()` leaves it in the page's
own language.

Gating: each piece is wrapped in `<!-- FAMILY:NAME --> … <!-- /FAMILY:NAME -->` (CSS, NAV, CARD,
FOOT). Because a source is also its EN output, the build first strips every FAMILY block from
it (`stripFamily()`), so the links follow the states and a build is reversible byte for byte.
The anchors (`FAMILY_ANCHORS` on the homepage, `familyAnchors(host)` on an app page) must each
occur exactly once, or a build that needs them stops.

### ABC: images made from the app icon (re-export if the app icon changes)

All of these are exported from the ABC app's icon master, `assets/icon/app_icon.png`
in the ABC repo (read with `git show <commit>:assets/icon/app_icon.png`, so only a
committed icon is ever used). If the app icon changes, re-export every one:

| File | Used for | Size |
|---|---|---|
| `abc/app-icon-96.webp`, `abc/app-icon-144.webp` | header logo on every ABC page (2× and 3× of 48 px) | 96×96, 144×144 |
| `abc/icon-32.png`, `abc/icon-180.png` | favicon and Apple touch icon of the ABC pages | 32×32, 180×180 |
| `abc/og-image.png` | share image of the ABC pages (icon on the sky, name in Nunito), also the JSON-LD `image` | 1200×630 |

### ABC: structured data (JSON-LD)

Each ABC page carries one schema.org `MobileApplication` block between `<!-- ABC:JSONLD -->` and
`<!-- /ABC:JSONLD -->` in the `<head>`, written by `appJsonLd()` from `rewriteAppHead()`.

- Filled only while `APPS.abc.state` is `launched`. In `hidden` and `preview` the marker pair is
  empty, so no store URL is published before the store pages are live.
- Per locale: `description` is that locale's `abc.meta.desc`, `url` that page's canonical URL.
  Shared: `name`, `image` (`/abc/og-image.png`, the build stops if it is missing),
  `operatingSystem` "iOS, Android", `applicationCategory` EducationalApplication, `inLanguage`
  (the seven spoken languages, `APPS.abc.jsonLd.inLanguage`), `installUrl` and `sameAs` (the two
  plain store URLs, no campaign tag), one free `offers` entry (price 0, EUR), `isAccessibleForFree`,
  and `author` exactly as in the Words homepage's `MobileApplication` (Organization BuraApps,
  https://flipandlearn.app). No rating, no audience, no age fields (the ABC rule: no age claim).
- Built with `JSON.stringify` from an object, `<` escaped as `<`, so no locale's text can break
  the JSON or close the `<script>`.
- Only an app with a `jsonLd` entry in `APPS` gets the block (123 has none, so its template needs
  no marker). Check: the JSON-LD lines in step 4 of Runbook 1, then paste one page into the
  Rich Results Test (https://search.google.com/test/rich-results).

### ABC: intro clip (carousel page 3)

The hero carousel's third page is the app's opening animation, tap to play. Files, shared
by all 31 pages (the splash has no language-dependent text; the clip ends on the splash's
final pose, before the hand-off to Home, whose menus are in the device language):

| File | What | Size |
|---|---|---|
| `abc/media/abc-intro.webm` | VP9, 532×1182, 60 fps, no audio (listed first) | 506,197 B |
| `abc/media/abc-intro.mp4` | H.264 Main, 532×1182, 60 fps, faststart, no audio (fallback) | 552,328 B |
| `abc/media/abc-intro-poster.webp` | the clip's last frame (complete logo) | 36,324 B |

Made from the trimmed master in `/Volumes/Data/BuraApps/media/abc/`
(`abc-splash-master-<abc-commit>-1080x2400.mp4`; also the raw take and a 1080×1920 reel
version). Re-record and re-encode if the app's splash changes.

Behaviour: nothing autoplays and the video file is not requested before the tap — the
`<video>` (muted, playsinline, preload="none") is created by the tap. It ends on the
poster with a "Replay" button; leaving page 3 pauses it. Without JS, page 3 stays hidden
and the carousel is the two screenshots. Strings: `abc.intro.play`, `abc.intro.replay`,
`abc.intro.alt`, `abc.shot.dot3`.

### ABC: hero tile check (run after every ABC template change and every locale batch)

The four floating letter tiles in the hero (Ș, ß, Gy, Ñ) sit on the outer corners of
the phone. `tools/check-abc-hero.mjs` proves, for every locale in `APPS.abc.locales` at 13
widths (320, 360, 375, 390, 393, 412, 414, 428, 430, 768, 1024, 1280, 1440) and with
the float animation frozen at its start, middle and peak, that each tile

- overlaps no text, chip, button, link or the status line in the hero (0 px²),
- is not clipped by any ancestor (overflow, clip-path, contain) or by the viewport,
- does not lie on the phone screenshot (0 px²).

Every page of the screenshot carousel is measured (page 3 is the intro clip with its play
button), elements inside the carousel count only with their visible part, and a page
whose visible carousel pages don't match its dots fails.

```bash
node build-locales.js
PLAYWRIGHT_DIR=/path/to/node_modules node tools/check-abc-hero.mjs
```

It serves the built pages itself, prints one line per width (with the smallest gap
between a tile and any hero element) and exits 1 on any failure. Playwright is not a
dependency of this repo; point `PLAYWRIGHT_DIR` at a `node_modules` folder that has
it. Options: `--locales=en,hu`, `--widths=390,1280`, and
`--crops=en:390,1280 --out=audits/abc-en-hero --tag=after` to save hero crops.

## Release day runbooks

The two apps launch independently, in either order. The state change touches only that app's
pages and privacy page, the sitemap and the config: links are already live in `preview`.

### Runbook 1: Flip & Learn ABC

Works whatever state 123 is in: the counts below are the same with 123 `hidden`,
`preview` or `launched`. Start from `preview`. A launch from `hidden` also changes the
homepages and 123's pages, so switch to `preview` first, as its own commit.

**a. Pre-launch checklist**

- [ ] App approved in App Store Connect and in Google Play production.
- [ ] `appStoreId` and `playPackage` in `APPS` match the stores: `6822385987` / `com.buraapps.flipandlearnabc`.
- [ ] Native reads done or consciously waived:
      - highest risk: sq, fi, et, lt, lv;
      - Lithuanian: the title and card line use "žaisdamas";
      - the other locales nobody has read (only en, de, hu, ro are checked by Laci);
      - the `family.more` and `family.num.*` lines, whichever app launches first.
- [ ] Words store titles in `tools/store/words_names.json` (ABC and Numbers repos, not this
      one) checked against the live stores.

**b. Launch**

Run in `/Volumes/Data/BuraApps/web`, from a tree with no change to any generated page.

1. Before: `node build-locales.js` prints `sitemap: 0 new, 0 touched, 0 removed` and changes
   nothing.
2. In `build-locales.js`, `APPS.abc`: `state: 'preview'` → `state: 'launched'`.
3. Build: `node build-locales.js`. Expect `sitemap: 32 new, 0 touched, 0 removed` and
   `abc: 31 page(s), LAUNCHED (indexable, store badges, in sitemap, family links shown)`.
4. Check. The comment on each line is the expected result:
   ```bash
   node build-locales.js | grep sitemap:                                   # 0 new, 0 touched, 0 removed
   git diff --name-only -- . ':!.gitignore' | wc -l                        # 34: 31 abc pages, abc/privacy.html, sitemap.xml, build-locales.js
   git diff --name-only | grep -cE '^([a-z]{2}/)?index\.html$'             # 0 homepages
   git diff --name-only | grep -cE '(^|/)123/'                          # 0 files of the other app
   git diff -- abc/index.html '*/abc/index.html' | grep -cE '^[-+].*(FAMILY|fam-)'   # 0: family links unchanged
   grep -l 'content="noindex' abc/index.html */abc/index.html | wc -l     # 0
   grep -l 'content="index,follow"' abc/index.html */abc/index.html | wc -l  # 31
   grep -l 'class="soon"' abc/index.html */abc/index.html | wc -l         # 0
   grep -l 'ct=web-abc' abc/index.html */abc/index.html | wc -l            # 31
   grep -l 'utm_campaign%3Dweb-abc' abc/index.html */abc/index.html | wc -l   # 31
   # each page carries its own locale's tag (web-abc-de on /de/abc/, web-abc-en on /abc/):
   for f in abc/index.html */abc/index.html; do l=${f%/index.html}; l=${l%/abc}; [ "$l" = abc ] && l=en; grep -q "ct=web-abc-$l&amp;" "$f" && grep -q "utm_campaign%3Dweb-abc-$l\"" "$f" || echo "BAD $f"; done   # no output
   grep -l 'apple-itunes-app" content="app-id=6822385987"' abc/index.html */abc/index.html | wc -l  # 31
   grep -l 'application/ld+json' abc/index.html */abc/index.html | wc -l  # 31: JSON-LD on every page
   node -e 'const fs=require("fs");let n=0;for(const f of process.argv.slice(1)){const m=/<!-- ABC:JSONLD -->\n<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/.exec(fs.readFileSync(f,"utf8"));JSON.parse(m[1]);n++}console.log(n)' abc/index.html */abc/index.html   # 31: every block parses
   grep -o 'name="robots" content="[^"]*"' abc/privacy.html                # index,follow
   git diff sitemap.xml | grep -c '^+    <loc>'                             # 32
   git diff sitemap.xml | grep -c '^+    <loc>.*/abc/'                        # 32
   git diff sitemap.xml | grep '^-' | grep -vc '^---'                       # 0 removed
   ```
   Then `PLAYWRIGHT_DIR=/path/to/node_modules node tools/check-abc-hero.mjs` exits 0. Open `/abc/`
   locally: the badges link to the real store pages.
5. Commit the sources and every generated file together, and push. Build drift must be
   green: `gh run list --workflow="Build drift" --limit 1`.
6. Verify live, after GitHub Pages has deployed (purge the Cloudflare cache if the old pages
   still show):
   ```bash
   curl -s https://flipandlearn.app/abc/ | grep -c 'content="noindex'        # 0
   curl -s https://flipandlearn.app/de/abc/ | grep -c 'ct=web-abc-de&amp;'    # 1
   curl -s https://flipandlearn.app/de/abc/ | grep -c 'application/ld+json'   # 1
   curl -s https://flipandlearn.app/abc/privacy.html | grep -o 'name="robots" content="[^"]*"'  # index,follow
   curl -s https://flipandlearn.app/sitemap.xml | grep -c '<loc>[^<]*/abc/'   # 32
   curl -sI "https://apps.apple.com/app/id6822385987" | head -1                # 200
   curl -sI "https://play.google.com/store/apps/details?id=com.buraapps.flipandlearnabc" | head -1   # 200
   ```
7. In Google Search Console, for `https://flipandlearn.app/abc/`: URL inspection → Request
   indexing.

**c. Rollback**

Set `state` in `build-locales.js`, build, build again (the second build prints `0 new, 0 touched,
0 removed`), then commit and push. Files stay on the server in both cases; they are noindex, and
Google drops them only once it has recrawled them.

| To | Effect | `sitemap:` line | Files changed (`git diff --name-only -- . ':!.gitignore'`) |
|---|---|---|---|
| `preview` | Keeps the family links. Removes indexing, badges, the meta and the sitemap entries; "Coming soon" returns | `0 new, 0 touched, 32 removed` | 34: 31 abc pages, `abc/privacy.html`, `sitemap.xml`, `build-locales.js`. Each is byte-identical to before the launch |
| `hidden` | Also removes every link to the app from the site | `0 new, 0 touched, 32 removed` | 96: the 34 above, 31 homepages, 31 pages of 123 |

With `hidden`, the homepages go from "More apps" and two cards to 123's direct link and one
card if 123 is visible, and to no family block if it is hidden. A later relaunch stamps
today's date on the 32 sitemap URLs.

### Runbook 2: Flip & Learn 123

Works whatever state ABC is in: the counts below are the same with ABC `hidden`,
`preview` or `launched`. Start from `preview`. A launch from `hidden` also changes the
homepages and ABC's pages, so switch to `preview` first, as its own commit.

**a. Pre-launch checklist**

- [ ] App approved in App Store Connect and in Google Play production.
- [ ] `appStoreId` and `playPackage` in `APPS` match the stores: `6826912900` / `com.buraapps.flipandlearn_numbers`.
- [ ] Native reads done or consciously waived:
      - 123 es, fr, it;
      - highest risk: sq, fi, et, lt, lv;
      - Lithuanian: the title and card line use "žaisdamas";
      - the other locales nobody has read (only en, de, hu, ro are checked by Laci);
      - the `family.more` and `family.num.*` lines, whichever app launches first.
- [ ] Words store titles in `tools/store/words_names.json` (ABC and Numbers repos, not this
      one) checked against the live stores.
- [ ] Decision taken on the awkward ARB game names. Any rename in the Numbers repo means new
      screenshots for the stores and the web.

**b. Launch**

Run in `/Volumes/Data/BuraApps/web`, from a tree with no change to any generated page.

1. Before: `node build-locales.js` prints `sitemap: 0 new, 0 touched, 0 removed` and changes
   nothing.
2. In `build-locales.js`, `APPS.num`: `state: 'preview'` → `state: 'launched'`.
3. Build: `node build-locales.js`. Expect `sitemap: 32 new, 0 touched, 0 removed` and
   `123: 31 page(s), LAUNCHED (indexable, store badges, in sitemap, family links shown)`.
4. Check. The comment on each line is the expected result:
   ```bash
   node build-locales.js | grep sitemap:                                   # 0 new, 0 touched, 0 removed
   git diff --name-only -- . ':!.gitignore' | wc -l                        # 34: 31 123 pages, 123/privacy.html, sitemap.xml, build-locales.js
   git diff --name-only | grep -cE '^([a-z]{2}/)?index\.html$'             # 0 homepages
   git diff --name-only | grep -cE '(^|/)abc/'                          # 0 files of the other app
   git diff -- 123/index.html '*/123/index.html' | grep -cE '^[-+].*(FAMILY|fam-)'   # 0: family links unchanged
   grep -l 'content="noindex' 123/index.html */123/index.html | wc -l     # 0
   grep -l 'content="index,follow"' 123/index.html */123/index.html | wc -l  # 31
   grep -l 'class="soon"' 123/index.html */123/index.html | wc -l         # 0
   grep -l 'ct=web-123' 123/index.html */123/index.html | wc -l            # 31
   grep -l 'utm_campaign%3Dweb-123' 123/index.html */123/index.html | wc -l   # 31
   grep -l 'apple-itunes-app" content="app-id=6826912900"' 123/index.html */123/index.html | wc -l  # 31
   grep -o 'name="robots" content="[^"]*"' 123/privacy.html                # index,follow
   git diff sitemap.xml | grep -c '^+    <loc>'                             # 32
   git diff sitemap.xml | grep -c '^+    <loc>.*/123/'                        # 32
   git diff sitemap.xml | grep '^-' | grep -vc '^---'                       # 0 removed
   ```
   Open `/123/` locally: the badges link to the real store pages. `check-abc-hero.mjs` covers ABC
   only; the 123 page has no such check.
5. Commit the sources and every generated file together, and push. Build drift must be
   green: `gh run list --workflow="Build drift" --limit 1`.
6. Verify live, after GitHub Pages has deployed (purge the Cloudflare cache if the old pages
   still show):
   ```bash
   curl -s https://flipandlearn.app/123/ | grep -c 'content="noindex'        # 0
   curl -s https://flipandlearn.app/de/123/ | grep -c 'ct=web-123'            # 1 or more
   curl -s https://flipandlearn.app/123/privacy.html | grep -o 'name="robots" content="[^"]*"'  # index,follow
   curl -s https://flipandlearn.app/sitemap.xml | grep -c '<loc>[^<]*/123/'   # 32
   curl -sI "https://apps.apple.com/app/id6826912900" | head -1                # 200
   curl -sI "https://play.google.com/store/apps/details?id=com.buraapps.flipandlearn_numbers" | head -1   # 200
   ```
7. In Google Search Console, for `https://flipandlearn.app/123/`: URL inspection → Request
   indexing.

**c. Rollback**

Set `state` in `build-locales.js`, build, build again (the second build prints `0 new, 0 touched,
0 removed`), then commit and push. Files stay on the server in both cases; they are noindex, and
Google drops them only once it has recrawled them.

| To | Effect | `sitemap:` line | Files changed (`git diff --name-only -- . ':!.gitignore'`) |
|---|---|---|---|
| `preview` | Keeps the family links. Removes indexing, badges, the meta and the sitemap entries; "Coming soon" returns | `0 new, 0 touched, 32 removed` | 34: 31 123 pages, `123/privacy.html`, `sitemap.xml`, `build-locales.js`. Each is byte-identical to before the launch |
| `hidden` | Also removes every link to the app from the site | `0 new, 0 touched, 32 removed` | 96: the 34 above, 31 homepages, 31 pages of ABC |

With `hidden`, the homepages go from "More apps" and two cards to ABC's direct link and one
card if ABC is visible, and to no family block if it is hidden. A later relaunch stamps
today's date on the 32 sitemap URLs.

## How to add a new site locale

1. **Translate.** Add a complete locale entry to the `T` dictionary inside
   `index.html` (between the `/* __LANG_DATA_BEGIN__ */` and `/* __LANG_DATA_END__ */`
   markers). Mirror the key set used by `en`. Required at minimum: `b1`, `b2`,
   `hero.sub` (used to derive `<title>` and `<meta description>`), the `cookies.*`
   keys, plus all the `data-i18n*` keys referenced in markup.
2. **Add the picker entry.** Add a flag + label entry to the `M` dictionary inside
   `index.html` (same script block). Example: `nl:{f:"🇳🇱",l:"NL"}`.
3. **Add the picker link.** In the `<div class="lang-menu" id="langMenu">` block of
   `index.html`, add a picker anchor mirroring the others. The app pages take their
   language names from these anchors.
4. **Add the privacy strings.** Add the locale to `P` and `PW` in `privacy-strings.js`.
5. **Add the family strings.** Add the locale to `F` in `family-strings.js`, with all 13 keys.
   The build stops without it.
6. **Add badge assets.** Drop `app-store-badge-xx.svg` and `google-play-badge-xx.png`
   into `badges/`. The build picks them up by locale code.
7. **Register the locale.** Add an entry to the `LOCALES` array in `build-locales.js`:
   ```js
   { code: 'nl', path: '/nl/', ogLocale: 'nl_NL', dir: 'ltr', isDefault: false },
   ```
8. **Update the FLI-61 IIFE.** In the inline script near the bottom of `index.html`
   that declares `const supported = ['en','de',...]`, add the new code so client-side
   browser-language detection on the root will pick it up.
9. **Run** `node build-locales.js`. The new pages are emitted and the sitemap gains
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

The app pages have no runtime language swap: each locale is a static page, and the
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
