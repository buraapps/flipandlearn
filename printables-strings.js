/**
 * printables-strings.js: UI copy of the per-sheet printable pages (build-printables.js).
 *
 * Same pattern as abc-strings.js: one object per locale. Placeholders are filled by the
 * generator, and the generator does the HTML escaping, so write plain text here.
 *   {subject}  the sheet's word, e.g. "Cat" (numbers: "Number Three")
 *   {word}     the sheet's word on its own
 *   {A} {B}    the two words printed on the sheet, in capitals
 *   {app}      this locale's appName
 *   {category} this locale's category label
 *
 * Rules:
 *   - appName is the Words app's Google Play title in the page's language, verbatim:
 *     flipandlearn_flutter android/fastlane/metadata/android/<locale>/title.txt
 *     Never inflect, shorten or translate it. Build the sentence around it.
 *   - The trademark rule applies to every string here: see the banned-term test in
 *     tests/printables.test.js. German uses Merkspiel only.
 *   - Age range on worksheet pages is 4 to 7, as on the hubs.
 *   - EN and DE are the pilot. RO and ES are filled but not yet in use, and need a native
 *     speaker's review before any RO or ES page is published.
 *
 * Per-sheet copy does not live here. It goes in the sheet's "copy" slot in
 * printables/sheets.json as { intro, tracingTips, activityIdeas: [...] }.
 */
const S = {
  en: {
    ogLocale: 'en_US',
    appName: 'Flip & Learn: Kids Vocabulary',
    numberPrefix: 'Number',
    title: '{subject} Coloring Page and Letter Tracing Worksheet (PDF) | Flip & Learn',
    h1: '{subject} coloring page with letter tracing',
    description: 'Free printable {subject} coloring page with letter tracing for ages 4 to 7. One A4 PDF with {A} and {B} as outline letters and numbered stroke-order arrows.',
    alt: '{word} coloring page with letter tracing for {A} and {B}',
    resourceName: '{subject} coloring page with letter tracing',
    subIntro: 'A printable A4 sheet for children ages 4 to 7. Free to download, with no sign-up.',
    subDetail: 'Your child colors the picture, then traces {A} and {B} along the numbered starting dots and arrows.',
    download: 'Download the PDF',
    downloadMeta: 'A4, one page, PDF',
    backToHub: 'All worksheets',
    breadcrumbHub: 'Printable worksheets',
    copyHeading: 'About this sheet',
    tipsHeading: 'Tracing tips for these letters',
    ideasHeading: 'Ways to use it with your child',
    moreHeading: 'More from {category}',
    printHeading: 'How to print it',
    printText: 'Print at 100 percent with no scaling, so the tracing letters come out at the size they were drawn for. Black and white is fine.',
    ctaHeading: 'The same matching game, on paper',
    ctaText: 'The two matching figures on this sheet work like the card pairs in {app}. A child who enjoys the sheet already knows how the app works, and the app adds spoken pronunciation, 21 themed categories and 9 languages.',
    categories: { animals: 'Animals', fruits: 'Fruits', vegetables: 'Vegetables', nature: 'Nature', numbers: 'Numbers', halloween: 'Halloween' },
  },
  de: {
    ogLocale: 'de_DE',
    appName: 'Flip & Learn: Kinder-Vokabeln',
    numberPrefix: 'Zahl',
    title: '{subject} Ausmalbild mit Schreibübung (PDF) | Flip & Learn',
    h1: '{subject}: Ausmalbild mit Schreibübung',
    description: 'Kostenloses Ausmalbild {subject} mit Schreibübung für Kinder von 4 bis 7 Jahren. Eine A4-PDF-Seite mit {A} und {B} als Umrissbuchstaben und nummerierten Pfeilen.',
    alt: 'Ausmalbild {word} mit Schreibübung für {A} und {B}',
    resourceName: '{subject}: Ausmalbild mit Schreibübung',
    subIntro: 'Ein A4-Blatt zum Ausdrucken, für Kinder von 4 bis 7 Jahren. Kostenlos und ohne Anmeldung.',
    subDetail: 'Ihr Kind malt zuerst das Bild aus und spurt dann {A} und {B} entlang der nummerierten Startpunkte und Pfeile nach.',
    download: 'PDF herunterladen',
    downloadMeta: 'A4, eine Seite, PDF',
    backToHub: 'Alle Ausmalbilder',
    breadcrumbHub: 'Ausmalbilder',
    copyHeading: 'Über dieses Blatt',
    tipsHeading: 'Tipps zum Nachspuren',
    ideasHeading: 'Ideen für Sie und Ihr Kind',
    moreHeading: 'Mehr aus der Kategorie {category}',
    printHeading: 'So drucken Sie das Blatt',
    printText: 'Drucken Sie mit 100 Prozent und ohne Skalierung, dann stimmen die Buchstabengrößen. Schwarz-Weiß reicht aus.',
    ctaHeading: 'Dasselbe Merkspiel, auf Papier',
    ctaText: 'Die zwei passenden Figuren auf diesem Blatt funktionieren wie die Kartenpaare in {app}. Wer gern mit dem Blatt arbeitet, kennt das Prinzip der App also schon. Dazu kommen gesprochene Aussprache, 21 Kategorien und 9 Sprachen.',
    categories: { animals: 'Tiere', fruits: 'Obst', vegetables: 'Gemüse', nature: 'Natur', numbers: 'Zahlen', halloween: 'Halloween' },
  },
  ro: {
    ogLocale: 'ro_RO',
    appName: 'Flip & Learn: Vocabular copii',
    numberPrefix: 'Numărul',
    title: '{subject}: fișă de colorat cu exercițiu de scriere (PDF) | Flip & Learn',
    h1: '{subject}: fișă de colorat cu exercițiu de scriere',
    description: 'Fișă de colorat gratuită {subject}, cu exercițiu de scriere, pentru copii de 4–7 ani. O pagină A4 în PDF, cu {A} și {B} scrise cu litere de contur și săgeți numerotate.',
    alt: 'Fișă de colorat {word} cu exercițiu de scriere pentru {A} și {B}',
    resourceName: '{subject}: fișă de colorat cu exercițiu de scriere',
    subIntro: 'O fișă A4 de printat, pentru copii de 4–7 ani. Gratuită și fără înregistrare.',
    subDetail: 'Copilul colorează desenul, apoi scrie {A} și {B} urmând punctele de pornire numerotate și săgețile.',
    download: 'Descarcă PDF-ul',
    downloadMeta: 'A4, o pagină, PDF',
    backToHub: 'Toate fișele',
    breadcrumbHub: 'Fișe de colorat',
    copyHeading: 'Despre această fișă',
    tipsHeading: 'Sfaturi pentru scris',
    ideasHeading: 'Idei de folosit cu copilul',
    moreHeading: 'Mai multe din categoria {category}',
    printHeading: 'Cum printezi fișa',
    printText: 'Printează la 100%, fără scalare, ca literele să iasă exact la mărimea la care au fost desenate. Alb-negru este suficient.',
    ctaHeading: 'Același joc de perechi, pe hârtie',
    ctaText: 'Cele două figuri identice de pe această fișă funcționează ca perechile de cartonașe din {app}. Un copil căruia îi place fișa știe deja cum funcționează aplicația, iar aplicația adaugă pronunție audio, 21+ categorii și 9 limbi.',
    categories: { animals: 'Animale', fruits: 'Fructe', vegetables: 'Legume', nature: 'Natură', numbers: 'Numere', halloween: 'Halloween' },
  },
  es: {
    ogLocale: 'es_ES',
    appName: 'Flip & Learn: Vocabulario',
    numberPrefix: 'Número',
    title: '{subject}: ficha para colorear y escribir (PDF) | Flip & Learn',
    h1: '{subject}: ficha para colorear y escribir',
    description: 'Ficha gratis para colorear y escribir {subject}, para niños de 4 a 7 años. Una página A4 en PDF con {A} y {B} en letras para repasar y flechas numeradas.',
    alt: 'Ficha para colorear y escribir: {A} y {B}',
    resourceName: '{subject}: ficha para colorear y escribir',
    subIntro: 'Una ficha A4 para imprimir, para niños de 4 a 7 años. Gratis y sin registro.',
    subDetail: 'Tu hijo colorea el dibujo y luego repasa {A} y {B} siguiendo los puntos de inicio numerados y las flechas.',
    download: 'Descargar el PDF',
    downloadMeta: 'A4, una página, PDF',
    backToHub: 'Todas las fichas',
    breadcrumbHub: 'Fichas para colorear',
    copyHeading: 'Sobre esta ficha',
    tipsHeading: 'Consejos para repasar las letras',
    ideasHeading: 'Ideas para usarla con tu hijo',
    moreHeading: 'Más de {category}',
    printHeading: 'Cómo imprimir la ficha',
    printText: 'Imprime al 100 %, sin escalar, para que las letras salgan al tamaño con el que se dibujaron. Basta con blanco y negro.',
    ctaHeading: 'El mismo juego de parejas, en papel',
    ctaText: 'Los dos dibujos iguales de esta ficha funcionan como las parejas de cartas de {app}. Si a tu hijo le gusta la ficha, ya sabe cómo funciona la app, que además tiene pronunciación, 21+ categorías y 9 idiomas.',
    categories: { animals: 'Animales', fruits: 'Frutas', vegetables: 'Verduras', nature: 'Naturaleza', numbers: 'Números', halloween: 'Halloween' },
  },
};

module.exports = { S };
