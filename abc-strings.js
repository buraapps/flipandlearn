/**
 * abc-strings.js — strings of the Flip & Learn ABC landing page (/abc/, /<loc>/abc/).
 *
 * Same pattern as the T table in index.html and P/PW in privacy-strings.js: one object
 * per locale, keyed by the data-i18n / data-i18n-aria keys used in abc/index.html.
 * build-locales.js merges A[code] over T[code] (which supplies the cookie.* and nav.*
 * keys of the shared chrome) and emits a page for every locale in ABC_LOCALES.
 *
 * Rules for every locale (see build-locales.md):
 *   - "Flip & Learn", "Flip & Learn ABC", "Flip & Learn Words", "ABC" and "Mo" are
 *     never translated.
 *   - Game names are the app's own on-screen names (ABC repo, lib/l10n/app_<loc>.arb).
 *   - The app teaches the alphabet of English, German, Spanish, French, Romanian,
 *     Hungarian or Italian — never the alphabet of the page's own language unless it
 *     is one of those seven.
 *   - No age claim. Never "completely free". Never the word "memory" or a cognate.
 */
'use strict';

const A = {
en: {
"abc.meta.title": "Flip & Learn ABC — Learn the alphabet by playing",
"abc.meta.ogalt": "The Flip & Learn ABC app icon next to the name Flip & Learn ABC",
"abc.meta.desc": "Nine letter games for small hands: matching, tracing, popping balloons and feeding Mo. Letters and words are spoken in seven languages. Free — no ads, no in-app purchases.",

"abc.nav.aria": "Page sections",
"abc.nav.games": "Games",
"abc.nav.languages": "Languages",
"abc.nav.parents": "For parents",
"abc.nav.words": "Words app",
"abc.lang.aria": "Change page language",

"abc.hero.h1": "Learn the alphabet by playing.",
"abc.hero.sub": "Nine little letter games for small hands — matching, tracing, popping balloons and feeding Mo the monster. Letters and words are spoken aloud in English, German, Spanish, French, Romanian, Hungarian and Italian.",
"abc.hero.soon": "Coming soon to the App Store and Google Play",
"abc.badge.apple": "Download Flip & Learn ABC on the App Store",
"abc.badge.play": "Get Flip & Learn ABC on Google Play",
"abc.chip.free": "Free",
"abc.chip.ads": "No ads",
"abc.chip.iap": "No in-app purchases",
"abc.chip.offline": "Works offline",
"abc.chip.data": "No data collected",

"abc.phone.alt": "The home screen of Flip & Learn ABC with four game buttons: Letter Match, Case Match, Word Match and Letter Trace.",
"abc.phone.lang": "English",
"abc.phone.parents": "For parents",
"abc.phone.pick": "Pick a game!",
"abc.phone.lm.sub": "Match the same letter",
"abc.phone.cm.sub": "Match capital and small",
"abc.phone.wm.sub": "Match letters to words",
"abc.phone.lt.sub": "Draw letters with your finger",
"abc.phone.word": "dolphin",

"abc.langs.eyebrow": "Letters of the world",
"abc.langs.h2": "Seven alphabets, special letters included.",
"abc.langs.p": "Pick one of seven languages. Its special letters, like Ș, ß, Ñ or Gy, are letters of their own in the games. When no word starts with a letter, Word Match uses a word that contains it.",
"abc.lang.n26": "26 letters",
"abc.lang.n27": "27 letters",
"abc.lang.n30": "30 letters",
"abc.lang.n31": "31 letters",
"abc.lang.n44": "44 letters",
"abc.menus.h3": "Menus in 18 languages",
"abc.menus.p": "English, German, Spanish, French, Italian, Portuguese, Romanian, Hungarian, Turkish, Slovenian, Dutch, Bulgarian, Ukrainian, Russian, Polish, Czech, Slovak and Croatian. With any other device language, the menus are in English.",

"abc.games.eyebrow": "Nine games, one alphabet",
"abc.games.h2": "A new way to meet the letters every day.",
"abc.game.lm.name": "Letter Match",
"abc.game.lm.desc": "Flip the cards and find two of the same letter. Its name is spoken on every match.",
"abc.game.cm.name": "Case Match",
"abc.game.cm.desc": "Pair every capital letter with its small partner.",
"abc.game.wm.name": "Word Match",
"abc.game.wm.desc": "Match a letter to a picture word that starts with it — animals, fruits and more.",
"abc.game.lt.name": "Letter Trace",
"abc.game.lt.desc": "Trace each letter with a finger, stroke by stroke. A moving dot shows the way first.",
"abc.game.bp.name": "Balloon Pop",
"abc.game.bp.desc": "Pop the balloons that carry the letters of the picture word. A new word every game.",
"abc.game.mo.name": "Hungry Mo",
"abc.game.mo.desc": "Mo is hungry. Feed him the pictures that start with his letter — and wait for the burp.",
"abc.game.cd.name": "Connect the Dots",
"abc.game.cd.desc": "Draw from letter to letter in alphabet order. At the last dot the picture fills with color and comes alive.",
"abc.game.lf.name": "Letter Fishing",
"abc.game.lf.desc": "Listen for the letter, then tap the fish that carries it. Five catches make a game.",
"abc.game.sb.name": "Sorting Baskets",
"abc.game.sb.desc": "Drag each picture into the basket of its first letter. Nothing is timed.",

"abc.parents.eyebrow": "For parents",
"abc.parents.h2": "Made by a parent. Safe by design.",
"abc.parents.p": "I build Flip & Learn in Regensburg, Germany, for my own son first. ABC has nothing to buy, nothing to sign up for, and it collects no data.",
"abc.parents.privacy": "Read the ABC privacy policy",
"abc.safe.ads.t": "No ads",
"abc.safe.ads.d": "Nothing pulls your child out of the game.",
"abc.safe.iap.t": "No in-app purchases",
"abc.safe.iap.d": "All nine games are included.",
"abc.safe.data.t": "No data collected",
"abc.safe.data.d": "The app saves only a few settings, and only on the device.",
"abc.safe.offline.t": "Works offline",
"abc.safe.offline.d": "No internet connection is needed to play.",
"abc.safe.gate.t": "Parents' area",
"abc.safe.gate.d": "Settings and links sit behind a parental gate.",
"abc.safe.hints.t": "Gentle hints",
"abc.safe.hints.d": "A lightbulb helps in the three matching games. Switch it off in the parents' area.",

"abc.words.eyebrow": "Next step: words",
"abc.words.h2": "Letters done? Time for words.",
"abc.words.p": "Flip & Learn Words is the word card game from the same family: 21+ categories, 9 languages, and every word spoken out loud.",
"abc.words.badge": "Teacher Approved on Google Play",
"abc.words.cta": "Discover Flip & Learn Words",

"abc.print.h2": "Free tracing worksheets",
"abc.print.p": "Print a coloring page and trace the word with a pencil. Then practice letters in Letter Trace.",
"abc.print.cta": "Get the printables",

"abc.foot.aria": "Footer",
"abc.foot.motto": "Education belongs to every child.",
"abc.foot.words": "Flip & Learn Words",
"abc.foot.privacy": "ABC privacy",
},
};

module.exports = { A };
