/**
 * 123-strings.js — strings of the Flip & Learn 123 landing page (/123/, /<loc>/123/).
 *
 * Same pattern as abc-strings.js: one object per locale, keyed by the data-i18n /
 * data-i18n-aria / data-i18n-alt keys used in 123/index.html. English only for now; the
 * other locales follow in batches, key for key. Not wired into build-locales.js yet.
 *
 * Rules for every locale (the rules of abc-strings.js):
 *   - "Flip & Learn", "Flip & Learn 123" and "123" are never translated.
 *   - The Words app is always called by its Google Play title in the page's language,
 *     verbatim: flipandlearn_flutter android/fastlane/metadata/android/<locale>/title.txt.
 *     Where Play has no localized title, use the English title. Never inflect, shorten or
 *     translate the name; build the sentence around it.
 *   - Game names are the app's own on-screen names (Numbers repo, lib/l10n/app_<loc>.arb).
 *     The app has no Portuguese or Arabic menus: on a page without its own menu language
 *     the names stay in English.
 *   - The numbers are spoken in English, German, Spanish, French, Romanian, Hungarian or
 *     Italian, never in the page's own language unless it is one of those seven.
 *   - Numbers go to 100; amounts are shown as pictures only up to 20. The app does not
 *     teach addition: no arithmetic claim. The splash's "1 + 2 = 3" is a teaser.
 *   - No age claim. Never "completely free". Never the word "memory" or a cognate.
 */

// "Mo" is a name, never translated and never suffixed in copy we write: phrase
// around it so it stays bare, as abc-strings.js does ("Mo etetése" in hu,
// "hrănirea lui Mo" in ro). The one exception is a game name quoted from the
// app's own ARB, which is quoted verbatim including any case ending the target
// language requires ("Etesd meg Mót"): that is the name of the button in the
// app, and misquoting it defeats the point of taking names from the ARB.

'use strict';

const N = {
en: {
"num.meta.title": "Flip & Learn 123 — Learn numbers by playing",
"num.meta.ogalt": "The Flip & Learn 123 app icon next to the name Flip & Learn 123",
"num.meta.desc": "Ten number games for small hands: matching, counting, tracing, popping balloons and feeding Mo. Numbers from 0 to 100 are spoken in seven languages. Free — no ads, no in-app purchases.",

"num.nav.aria": "Page sections",
"num.nav.games": "Games",
"num.nav.languages": "Languages",
"num.nav.parents": "For parents",
"num.nav.words": "Flip & Learn: Word Card Game",
"num.lang.aria": "Change page language",

"num.hero.h1": "Learn numbers by playing.",
"num.hero.sub": "Ten little number games for small hands — matching, counting, tracing, popping balloons and feeding Mo. Numbers from 0 to 100 are spoken aloud in English, German, Spanish, French, Romanian, Hungarian and Italian.",
"num.hero.soon": "Coming soon to the App Store and Google Play",
"num.badge.apple": "Download Flip & Learn 123 on the App Store",
"num.badge.play": "Get Flip & Learn 123 on Google Play",
"num.chip.free": "Free",
"num.chip.ads": "No ads",
"num.chip.iap": "No in-app purchases",
"num.chip.offline": "Works offline",
"num.chip.data": "No data collected",
"num.shot.aria": "Screenshots of the app",
"num.shot.p1.alt": "Flip & Learn 123 Home screen, page 1: Pair Match, Count Match, Word Match, Order Match",
"num.shot.p2.alt": "Flip & Learn 123 Home screen, page 2: Balloon Pop, Feed Mo, Number Fishing, Sorting Baskets, Connect the Dots, Number Trace",
"num.shot.prev": "Previous screen",
"num.shot.next": "Next screen",
"num.shot.dot1": "Show page 1",
"num.shot.dot2": "Show page 2",

"num.langs.eyebrow": "Numbers of the world",
"num.langs.h2": "Seven languages, every number spoken.",
"num.langs.p": "Pick one of seven languages on the home screen, and the app remembers it. Every number from 0 to 100 is spoken in that language.",
"num.menus.h3": "Menus in 17 languages",
"num.menus.p": "English, German, Spanish, French, Italian, Romanian, Hungarian, Turkish, Slovenian, Dutch, Bulgarian, Ukrainian, Russian, Polish, Czech, Slovak and Croatian. With any other device language, the menus are in English.",

"num.games.eyebrow": "Ten games, one skill at a time",
"num.games.h2": "A new way to meet the numbers every day.",
"num.games.lead": "Every game has three levels, from the first numbers up to 10, through 20, and in several games up to 100. Amounts are shown as pictures only up to 20.",
"num.games.cards": "Card games",
"num.games.mo": "Play with Mo",
"num.game.pm.name": "Pair Match",
"num.game.pm.desc": "Flip the cards and find two with the same number. It is spoken on every match.",
"num.game.cm.name": "Count Match",
"num.game.cm.desc": "Match a number to the right amount of dots or things.",
"num.game.wm.name": "Word Match",
"num.game.wm.word": "five",
"num.game.wm.desc": "Tap a listen card, hear the number and find its digit.",
"num.game.om.name": "Order Match",
"num.game.om.desc": "Which number comes next? Find the card that follows.",
"num.game.bp.name": "Balloon Pop",
"num.game.bp.desc": "Mo says a number. Pop the balloon that carries it.",
"num.game.mo.name": "Feed Mo",
"num.game.mo.desc": "Count cookies onto Mo's plate, one by one.",
"num.game.nf.name": "Number Fishing",
"num.game.nf.desc": "See small amounts at a glance, then count on in order.",
"num.game.sb.name": "Sorting Baskets",
"num.game.sb.desc": "Sort by number, by more and fewer, and by odd and even.",
"num.game.cd.name": "Connect the Dots",
"num.game.cd.desc": "Count from dot to dot until a picture appears.",
"num.game.nt.name": "Number Trace",
"num.game.nt.desc": "Write the digits 0–9 and bigger numbers with a finger.",

"num.parents.eyebrow": "For parents",
"num.parents.h2": "Made for children, with parents in mind.",
"num.parents.p1": "I started Flip & Learn for my own son, and I still build each app myself in Regensburg, Germany.",
"num.parents.p2": "In Flip & Learn 123 there is nothing to buy and no account to create, and no data leaves the device.",
"num.parents.privacy": "Read the 123 privacy policy",
"num.safe.ads.t": "No ads",
"num.safe.ads.d": "Your child plays without interruptions.",
"num.safe.iap.t": "No in-app purchases",
"num.safe.iap.d": "All ten games are there from the start.",
"num.safe.data.t": "No data collected",
"num.safe.data.d": "A few settings stay on the device, and nothing is sent anywhere.",
"num.safe.offline.t": "Works offline",
"num.safe.offline.d": "Play anywhere, with or without internet.",
"num.safe.gate.t": "Parents' area",
"num.safe.gate.d": "A parent gate protects the settings and every link out of the app.",
"num.safe.hints.t": "Gentle hints",
"num.safe.hints.d": "A lightbulb shows a pair in the card games. You can turn it off in the parents' area.",

"num.words.eyebrow": "Also from Flip & Learn",
"num.words.h2": "Numbers and words, side by side.",
"num.words.p": "Flip & Learn: Word Card Game comes from the same family: 21+ categories, 9 languages, and every word spoken out loud.",
"num.words.badge": "Teacher Approved on Google Play",
"num.words.card": "dog",
"num.words.cta": "Discover Flip & Learn: Word Card Game",

"num.print.h2": "Free number worksheets",
"num.print.p": "Ten A4 PDFs to print, from one to ten. Color the number and the same amount of pictures, then trace its word in two languages, following the numbered arrows.",
"num.print.cta": "Get the worksheets",

"num.foot.aria": "Footer",
"num.foot.motto": "Education belongs to every child.",
"num.foot.words": "Flip & Learn: Word Card Game",
"num.foot.privacy": "123 privacy",
},
};

module.exports = { N };
