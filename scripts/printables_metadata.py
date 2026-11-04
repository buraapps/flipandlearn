#!/usr/bin/env python3
"""PDF metadata for the printables worksheets: one place for the convention.

The worksheet artwork is pure vector with no text layer, so the PDF Info
dictionary is the only on-document signal search engines get. Google shows
/Title in results; a sheet without it shows up as "Untitled".

Every newly generated sheet (any layout: the matching-pair cards or the
Halloween colour-and-trace page) must go through `apply` before it is
committed. `check` is the gate; tests/printables.test.js also fails on any
PDF without a /Title.

  python3 scripts/printables_metadata.py check
  python3 scripts/printables_metadata.py apply printables/ro-de/flipandlearn_halloween_03_stafie_geist.pdf
  python3 scripts/printables_metadata.py apply FILE --words "Stafie/Geist"   # override the display words

`apply` writes an incremental update: the original bytes, page content
included, stay untouched and only a new Info dictionary and catalog are
appended. Info keys it does not own (CreationDate, Producer) are kept.

`check` requires the exact Title, Author, Subject, Keywords and Creator for
the sheet's set, and the catalog /Lang (the sheet's first language).

File names follow flipandlearn_<category>_<NN>_<word1>_<word2>.pdf. File names
drop diacritics; display words restore them from DISPLAY below (precomposed
NFC characters, Romanian Ș/Ț with comma below). Add new words there when a
new sheet uses a letter that the file name flattens.

Dependency: pypdf >= 5 (pip install --break-system-packages pypdf).
"""
import argparse
import glob
import os
import sys
import unicodedata

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
AUTHOR = 'BuraApps – Flip & Learn'
CREATOR = 'Flip & Learn – flipandlearn.app'

SETS = {
    # folder under printables/ -> convention. lang = the sheet's primary language (first word).
    '': dict(
        lang='de',
        title='Flip & Learn – Ausmalbild & Schreibübung: {a} / {b} (A4)',
        subject=('Kostenlose Ausmalvorlage und Buchstaben-Schreibübung für Kinder von 4 bis 7 Jahren. '
                 'Free printable coloring and letter-tracing worksheet for children ages 4 to 7.'),
        tail='Ausmalbild, Ausmalbilder, Vorschule, Schreiben lernen, coloring page, handwriting practice, preschool, tracing',
        categories=dict(animals=('Tiere', 'Animals'), fruits=('Obst', 'Fruits'), nature=('Natur', 'Nature'),
                        numbers=('Zahlen', 'Numbers'), vegetables=('Gemüse', 'Vegetables'),
                        halloween=('Halloween', 'Halloween')),
    ),
    'ro-de': dict(
        lang='ro',
        title='Flip & Learn – Fișă de colorat și scriere: {a} / {b} (A4)',
        subject=('Fișă gratuită de colorat și exersare a scrierii pentru copii de 4–7 ani. '
                 'Kostenlose Ausmalvorlage und Buchstaben-Schreibübung für Kinder von 4 bis 7 Jahren.'),
        tail='fișă de colorat, fișe de colorat, planșe de colorat, exerciții de scriere, grădiniță, Ausmalbild, Rumänisch, Schreibübung',
        categories=dict(animale=('Animale', 'Tiere'), fructe=('Fructe', 'Obst'), legume=('Legume', 'Gemüse'),
                        natura=('Natură', 'Natur'), numere=('Numere', 'Zahlen'),
                        halloween=('Halloween', 'Halloween')),
    ),
    'es-en': dict(
        lang='es',
        title='Flip & Learn – Ficha para colorear y escribir: {a} / {b} (A4)',
        subject=('Ficha gratuita para colorear y practicar la escritura, para niños de 4 a 7 años. '
                 'Free printable coloring and letter-tracing worksheet for children ages 4 to 7.'),
        tail='fichas para colorear, dibujos para colorear, fichas de caligrafía, aprender inglés, infantil, coloring page, English, tracing',
        categories=dict(animales=('Animales', 'Animals'), frutas=('Frutas', 'Fruits'), naturaleza=('Naturaleza', 'Nature'),
                        numeros=('Números', 'Numbers'), verduras=('Verduras', 'Vegetables'),
                        halloween=('Halloween', 'Halloween')),
    ),
}

# File-name slug -> display word, per set, where capitalising the slug is not enough.
_DE = dict(kuerbis='Kürbis', fuenf='Fünf')
DISPLAY = {
    '': dict(_DE),
    'ro-de': dict(_DE, pisica='Pisică', caine='Câine', rata='Rață', mar='Măr', para='Pară', cireasa='Cireașă',
                  lamaie='Lămâie', ceapa='Ceapă', mazare='Mazăre', natura='Natură', sase='Șase', sapte='Șapte',
                  noua='Nouă', vrajitoare='Vrăjitoare', paianjen='Păianjen', matura='Mătură'),
    'es-en': dict(limon='Limón', arbol='Árbol', maiz='Maíz', arana='Araña'),
}


def set_of(path):
    rel = os.path.relpath(os.path.abspath(path), os.path.join(ROOT, 'printables'))
    folder = os.path.dirname(rel)
    if folder not in SETS:
        sys.exit(f'{path}: not in a known printables set folder ({", ".join(repr(k) for k in SETS)})')
    return folder


def parse_name(path):
    stem = os.path.basename(path)[:-4]
    parts = stem.split('_')
    if len(parts) != 5 or parts[0] != 'flipandlearn' or not parts[2].isdigit():
        sys.exit(f'{path}: name must be flipandlearn_<category>_<NN>_<word1>_<word2>.pdf')
    return parts[1], parts[3], parts[4]


def expected(path, words=None):
    key = set_of(path)
    conv = SETS[key]
    cat, s1, s2 = parse_name(path)
    if cat not in conv['categories']:
        sys.exit(f'{path}: add category "{cat}" to SETS[{key!r}]["categories"] first')
    if words:
        a, b = (w.strip() for w in words.split('/'))
    else:
        disp = DISPLAY[key]
        a, b = (disp.get(s, s.capitalize()) for s in (s1, s2))
    a, b = (unicodedata.normalize('NFC', w) for w in (a, b))
    c1, c2 = conv['categories'][cat]
    kw = [a, b, c1] + ([c2] if c2 != c1 else []) + [conv['tail']]
    return dict(title=conv['title'].format(a=a, b=b), author=AUTHOR, subject=conv['subject'],
                keywords=', '.join(kw), creator=CREATOR, lang=conv['lang'])


def apply(path, words=None):
    exp = expected(path, words)
    writer = PdfWriter(path, incremental=True)
    meta = dict(PdfReader(path).metadata or {})
    meta.update({'/Title': exp['title'], '/Author': exp['author'], '/Subject': exp['subject'],
                 '/Keywords': exp['keywords'], '/Creator': exp['creator']})
    # Always write the Info dictionary as a NEW object. pypdf (6.19) only puts /Info into an
    # incremental trailer when the Info object changed; with unchanged values the new trailer
    # has no /Info, trailer keys are not inherited through /Prev, and poppler (and so, likely,
    # Google) then sees no Title at all.
    writer._info_obj = writer._add_object(
        DictionaryObject({NameObject(k): TextStringObject(v) for k, v in meta.items()}))
    writer._root_object[NameObject('/Lang')] = TextStringObject(exp['lang'])
    size = os.path.getsize(path)
    with open(path, 'rb') as fh:
        original = fh.read()
    with open(path, 'wb') as fh:
        writer.write(fh)
    with open(path, 'rb') as fh:
        data = fh.read()
    appended = data[size:]
    if data[:size] != original or b'/Info ' not in appended or b'/Root ' not in appended:
        with open(path, 'wb') as fh:
            fh.write(original)
        sys.exit(f'{path}: incremental update is missing /Info or /Root in its trailer; original restored')
    return exp


def all_pdfs():
    return sorted(glob.glob(os.path.join(ROOT, 'printables', '**', '*.pdf'), recursive=True))


def check():
    bad = 0
    for p in all_pdfs():
        rel = os.path.relpath(p, ROOT)
        r = PdfReader(p)
        m = r.metadata or {}
        exp = expected(p)
        errs = []
        if (m.get('/Title') or '') != exp['title']:
            errs.append(f'Title {m.get("/Title")!r} != {exp["title"]!r}')
        for key, name in (('/Author', 'author'), ('/Subject', 'subject'), ('/Keywords', 'keywords'),
                          ('/Creator', 'creator')):
            if (m.get(key) or '') != exp[name]:
                errs.append(f'{key[1:]} {m.get(key)!r} != {exp[name]!r}')
        lang = r.trailer['/Root'].get('/Lang')
        if lang != exp['lang']:
            errs.append(f'Lang {lang!r} != {exp["lang"]!r}')
        if errs:
            bad += 1
            print(f'FAIL {rel}: ' + '; '.join(errs))
    print(f'{len(all_pdfs()) - bad}/{len(all_pdfs())} PDFs pass')
    return bad == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('check', help='verify every printables PDF against the convention (incl. /Lang)')
    a = sub.add_parser('apply', help='stamp metadata into PDFs in place (incremental update)')
    a.add_argument('pdfs', nargs='+')
    a.add_argument('--words', help='"Word1/Word2" display override (single PDF only)')
    args = ap.parse_args()
    if args.cmd == 'check':
        sys.exit(0 if check() else 1)
    if args.words and len(args.pdfs) != 1:
        sys.exit('--words takes exactly one PDF')
    for p in args.pdfs:
        exp = apply(p, args.words)
        print(f'OK {os.path.relpath(p, ROOT)}: {exp["title"]} [{exp["lang"]}]')


if __name__ == '__main__':
    main()
