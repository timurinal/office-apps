# The pptx fidelity corpus

The same bar as the docx and xlsx corpora, for Slides: "does it open and save a PowerPoint deck properly" is a set of
files. `corpus.test.ts` reads each one, says what must be in it, writes it back out, reads that, and compares.
`python.test.ts` has python-pptx, a reader that is not ours, open everything we export. `hostile.test.ts` is the files
that must be refused or neutralised. `fuzz.test.ts` damages the corpus at random and checks nothing but a `FormatError`
comes out. `schema.test.ts` checks what the reader makes against the slide text schema and `safe.ts` that the model uses.

```
*.pptx                 33 decks made for this corpus, one family of features each, with <name>.expect.json
hostile/               files that must be refused or neutralised, below
../generate/           make_pptx.mjs (decks 01 to 30), pptx_lib.mjs (the three writers), make_python_pptx.py (decks 31 to 33),
                       make_pptx_images.py (the pictures), check_pptx.py (the python-pptx half of python.test.ts)
out/                   what python.test.ts exports for python-pptx to open. Git ignores it
worker-check.mjs       the converters in a real Web Worker in headless Chromium, with times
```

Nothing was downloaded. **There is no deck here that PowerPoint, Google Slides or LibreOffice saved.** Decks 01 to 30 are
hand-written OOXML in the three dialects, from what those programs' files look like: PowerPoint's master with its five
placeholders and `p:style` on shapes, `mc:AlternateContent` transitions and the Office theme; Google's 10 in wide slide,
`Google Shape;N;pM` names, explicit properties on every paragraph and run, and a colour map that sends `bg2` to `dk2`;
LibreOffice's explicit geometry on every placeholder, `Liberation Sans` runs and layouts named as Impress names them.
python-pptx opens every one of them, which says they are sound, not that they are what those programs write.

Decks 31 to 33 are the nearest to real: python-pptx ships PowerPoint's own 2007 template (`default.pptx`: its master,
eleven layouts and Office theme) and writes charts, tables, groups and notes in the XML PowerPoint reads. Their
expectations are python-pptx's own reading of what it wrote, including the place it works out for a placeholder that
states none, so the reader is held to an implementation that is not ours. `make_python_pptx.py` needs python-pptx and Pillow.

## What is in the decks

`<name>.expect.json` is written by the generator from what it wrote (the text, kind and place of each element), so the
reader is held to something it did not produce.

| File | Covers |
|---|---|
| `01-powerpoint-basic` | runs with bold, italic, underline, strike, size and colour; a centred paragraph; a rounded rectangle on `p:style` (fill, line and text colour from the theme); a line with two ends |
| `02-powerpoint-layouts` | all six layouts: Title Slide, Section Header, Two Content, Title Only, Blank, Title and Content; a footer and a slide-number field; places inherited from layout and master |
| `03-theme-colours` | `lumMod`/`lumOff` tints, `tint`, `alpha` on theme and hex colours, a hex colour with `lumMod`, a system and a preset colour, and a master whose map sends `bg1` to `dk1` |
| `04-google-basic`, `05-google-table-pictures` | a 9144000 x 5143500 deck, explicit bullets and spacing on each paragraph, a table with borders and fills, pictures |
| `06-libreoffice-basic`, `07-libreoffice-4x3` | Impress-style placeholders, notes, a deck at 4:3 |
| `08-aspect-16x10`, `09-aspect-4x3-powerpoint` | the other two aspects, and the type that scales with the slide |
| `10-groups-nested` | a group that doubles its children, a group in a group, a group flipped across |
| `11-tables-merges` | `gridSpan`, `rowSpan`, `hMerge`, `vMerge` together, fills, an anchor, a table with no style |
| `12-charts` | column, bar, line, pie, scatter, area and doughnut, with their caches |
| `13-notes`, `14-hidden-slides` | notes with formatting; two hidden slides |
| `15-transitions` | fade, push, wipe, zoom, cut, dissolve, cover, blinds, and two `p14` ones through `mc:AlternateContent` with a time |
| `16-images-crop` | PNG, JPEG, GIF and WebP; `srcRect`; an SVG with its PNG fallback; an EMF alone; a linked picture |
| `17-hyperlinks` | web, mail, `javascript:`, `file:` and a jump to another slide |
| `18-bullets-numbering` | nine levels, the six number styles, a character, a Wingdings bullet, none |
| `19-custom-geometry`, `20-shapes-lines` | a freeform, a flowchart shape, a preset the deck has no form for; twelve presets, dashes, arrow ends, a rotated shadow, flips, an elbow connector |
| `21-backgrounds` | the master's, solid, gradient, picture, and the theme's `bgRef` |
| `22-120-slides` | a hundred and twenty slides, pictures, notes |
| `23-smartart-ole` | SmartArt through its saved drawing; an OLE object through its picture; one whose picture is an EMF |
| `24-multi-master` | a second master with its own theme, fonts and band, folded into the first |
| `25-text-formats` | super and subscript, theme fonts, highlight, a line break, a slide-number field, vertical text, autofit, spacing, a margin |
| `26-placeholder-inheritance` | a title and a body with no place of their own, one with its own |
| `27-unicode` | Latin, Cyrillic, Greek, CJK, Hangul, Arabic, Hebrew, emoji, a flag, maths |
| `28-strict-namespaces` | the same deck in the strict namespaces |
| `29-edge-cases` | an empty slide, empty placeholders, a hidden shape, a zero-size one, shapes off the slide |
| `30-master-decorations` | a master shape hidden by a layout and by a slide |
| `31-python-pptx-default` | PowerPoint's template: eleven layouts, levels, a run with a link, a picture, a table with two merges, a rounded rectangle in "Accent 2, lighter 40%", a rotated arrow, a group, a connector, a text box, notes |
| `32-python-pptx-widescreen` | the same template with only the slide size changed, as a person who resizes a deck has it |
| `33-python-pptx-charts` | column, bar, line, pie, scatter, area, doughnut, stacked column and bubble, as python-pptx writes them, each with its workbook |

## `hostile/`

Files that **must** be refused (the code and the words a person is shown are asserted) or neutralised (read, with what
was dangerous gone and the rest intact). `make_pptx.mjs` makes them; `formats/security.test.ts` builds the same attacks in
memory and times the ones that are about speed.

| File | What it does | What happens |
|---|---|---|
| `zip-bomb` | 77 KB that declare 72 MiB of media | refused before anything is inflated: "That file is too large to open." |
| `entity-expansion` | the billion laughs in a slide | refused: "That file could not be opened." |
| `doctype-external` | an external entity that names `/etc/passwd`, in `presentation.xml` | refused; nothing is read |
| `too-many-slides` | 501 slides | refused: "That presentation is too large." |
| `deep-xml` | XML nested 400 deep | refused |
| `not-a-presentation`, `truncated`, `zip-of-something-else` | text, half a zip, a zip with a Word part | refused: "That is not a presentation." |
| `external-rels` | an external picture, a path that climbs out of the package, an absolute one, an external part on the master | none followed, named or kept; the rest of the slide is read |
| `javascript-links` | nine links: `javascript:` (twice, once in capitals), `data:`, `vbscript:`, `file:`, `ftp:`, a tab inside `java script:`, a web and a mail address | only the last two stay; all nine texts stay |
| `huge-slide-size` | `sldSz` of 2147483647 | the slide is 16:9, and it says so |
| `huge-shapes` | an extent of 9e15 EMU, a rotation of 99999999999, a line of 1e12, text of 999999999 hundredths, a 9e12-wide table column, a span of 99999999 | every number is one a slide can hold |
| `lying-picture` | an SVG with a script, a web page and an executable named `.png`; a PNG and a JPEG with the wrong names | the three that are not pictures are gone; the two that are, are what they are |
| `too-many-shapes` | 600 shapes on one slide | 400 are kept and it says 200 were not |
| `deep-groups` | 30 groups in each other | flattened at 8; the text inside is kept |

## Running it

```sh
npx vitest run tests/corpus/pptx web/src/formats/pptx      # the reader, the writer, the corpus, the refusals, the fuzz
FUZZ_SEEDS=400 npx vitest run tests/corpus/pptx/fuzz.test.ts   # a longer fuzz; a failure names its seed
node tests/corpus/pptx/worker-check.mjs                    # in a real Web Worker; give it a path to time another deck
node tests/corpus/generate/make_pptx.mjs                   # remake decks 01 to 30 and hostile/ (it clears only what it makes)
tests/corpus/.venv/bin/python -I tests/corpus/generate/make_python_pptx.py   # remake decks 31 to 33
```

`python.test.ts` needs python-pptx. Without it the test says it was skipped and why; it never passes by not running.
openpyxl, if the same interpreter has it, also reads the workbook behind every exported chart:

```sh
python3 -m venv tests/corpus/.venv
tests/corpus/.venv/bin/pip install python-pptx openpyxl
npx vitest run tests/corpus/pptx/python.test.ts                 # or CORPUS_PYTHON=/path/to/python
```

To change a generated deck, edit `generate/make_pptx.mjs` (or `pptx_lib.mjs`) and run it; the files are committed so the
tests depend on neither the script nor any library. `make_pptx_images.py` needs Pillow and writes `pptx_images.mjs`.

## What the round trip compares, and what it does not

Import, export, import again, and compare the two decks (`outline` in `helpers.ts`): the slide count and the size; the
layouts' names and placeholders; per slide its layout, whether it is hidden, whether the master shows, its notes, its
transition and the side it comes from; per element its kind, placeholder type and idx, text, box to within a pixel, shape,
rotation, table (size, spans, cell texts), chart (kind, categories, series), picture (bytes, crop), and a group's
children the same way. A second trip is then compared with the first, byte for byte of the JSON. These are not counted as
differences, because they are not:

- a group's own rotation and flips. A group is written with the identity transform, its children where the deck has
  them (a rotated group's children were turned into place on import), so the group comes back unrotated;
- the names of shapes that had none (`Shape 3`), which the file now carries;
- `master.bg` when the master stated none: the file now says it is `bg1`.

## Timings

`worker-check.mjs` bundles the converters with esbuild into a module Worker and runs the corpus in headless Chromium
(this machine, Chromium from `/usr/bin/chromium`). The 120-slide deck reads in 50 to 60 ms inside the worker and is
back on the page, deck and all, in under 80 ms from `postMessage`. A heavier one, made for the measurement and not kept (120 slides, 120 different pictures
of 150 KB, thirty text boxes and a table on each, 17 MB), reads in about 580 ms and 620 ms to the page; its export
takes about a second. 500 slides with 75,000 shapes is 2 s: the file is 1.5 MB, and it is the parse.

## What it does not say

**PowerPoint and LibreOffice are not installed on the machine this was written on, so no file was rendered or opened by
them.** Nothing here says what a slide looks like, whether PowerPoint opens an export without offering to repair it, or
whether a transition runs. It says the files are well-formed XML in the order the schema is understood to ask for (no XSD validator was to hand), every relationship has a
target and every part a content type, python-pptx (and openpyxl, for the chart workbooks) read them and agree with our
reader, and what is in them is what went in. **The first job for whoever has a copy of PowerPoint is to open every file
in `out/`.**

WebP is the one thing python-pptx does not know (it reads the picture's content type off the part). PowerPoint 2022 and
earlier does not show a WebP picture.

Not read, and said so in the importer's warnings where a file has them: animations, comments, custom paths (a rectangle
with a warning), table styles and per-cell borders, effects beyond an outer shadow, 3D, text effects, columns, tab stops,
right-to-left paragraph direction, capitals and character spacing, East Asian and complex-script typefaces (only `latin` is kept), embedded fonts and
media (a clip is its poster frame), sections, handout and notes-master styling, a chart's axes, legend, labels and
grouping (stacked and percent-stacked are drawn side by side, and it says so), a pie's per-slice colours, and an elbow or curved connector (drawn straight). SmartArt is the
drawing PowerPoint saved with it: it does not lay out again when edited.
