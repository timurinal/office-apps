# The docx fidelity corpus

The bar for "does Docs open and save a Word document properly" is not a promise, it is a set of
files. `corpus.test.ts` reads each one, says what must be in it, writes it back out, reads that,
and compares. `python.test.ts` has python-docx, a reader that is not ours, open everything we
export. `e2e-files.mjs` does the same through the real page.

```
docx/            made for this corpus, one family of features each (generate/ says how)
docx/real/       real documents from other people's projects, below
docx/hostile/    files that must be refused, below
generate/        make_python_docx.py and make_docx_package.mjs: how docx/ was made
out/             what python.test.ts exports for python-docx to open. Git ignores it
```

## What is in `docx/`

Ten were made with python-docx, which writes what Word's own templates write, and five with the
`docx` package, for what python-docx has no API for.

| File | Covers |
|---|---|
| `01-formatting` | bold, italic, underline, strike, sub and superscript, fonts, sizes, colours, highlight, alignment, spacing, indent |
| `02-lists` | bullets and numbers, and the second level of each |
| `03-tables` | a header row, shading, merges across and down, a table in a cell |
| `04-images` | PNG, JPEG, GIF; in a sentence, centred, with alt text, the same picture twice |
| `05-comments` | comments on one run and across two |
| `06-page-setup` | Letter, landscape, margins, a different first page, headers, footers, page-number fields |
| `07-styles` | Title, Subtitle, headings, Quote, No Spacing, custom styles on a `basedOn` chain, a character style |
| `08-breaks-sections` | page breaks, a break before, new-page, continuous and landscape sections |
| `09-unicode` | Latin, Cyrillic, Greek, CJK, Arabic, Hebrew, emoji, symbols, tabs, line breaks, a long word |
| `10-large` | 12 chapters, 36 sections, 12 tables, about 40 pages |
| `11-links-footnotes` | web, mail, `javascript:`, `data:` and internal links; three footnotes |
| `12-tracked-changes` | a replacement, an insertion and a deletion by two people |
| `13-numbering` | legal, roman and letter numbering, a start at five, a count that continues, bullets with children |
| `14-threaded-comments` | replies, a resolved thread, three comments on one range |
| `15-toc-fields` | a table of contents, a date field, a page break before a heading |

## What is in `docx/real/`

Real Word, LibreOffice and POI-made documents, taken unchanged. Their licences allow it; the
copyright stays with their authors.

| File | Source | Licence | SHA-256 |
|---|---|---|---|
| `par-known-paragraphs.docx` | python-docx `features/steps/test_files/` | MIT | `0e1381929a0833057ef0095e42f0d34f9a456821b8e9053489b596b1b417b3c9` |
| `tbl-having-tables.docx` | python-docx `features/steps/test_files/` | MIT | `5e23ecb6ec09b5db467ddeb22110c2aab83d1218662e8f7c8db444f085e081cc` |
| `comments-rich-para.docx` | python-docx `features/steps/test_files/` | MIT | `8ee6b9bd84c59169bc7e5838003806edefb2c51920f40035b7879d4a3414deed` |
| `sct-first-page-hdrftr.docx` | python-docx `features/steps/test_files/` | MIT | `9e7e7b1bd132fe889d43d57fbe1e99c126544326fa21364695f2eec7cd336578` |
| `delins.docx` | Apache POI `test-data/document/` | Apache-2.0 | `7ecad102602586be7f1371f117fc567ea47f3ed0ca703b353e003002f1ff8d3f` |
| `footnotes.docx` | Apache POI `test-data/document/` | Apache-2.0 | `9070094b27ff5201477f4de4b2c027730c66cb889106a1609c5adeed207a59c1` |
| `table_footnotes.docx` | Apache POI `test-data/document/` | Apache-2.0 | `69666500a7dd00600da64cc7676f8939c84df8804967ec2fc75567fad41f21a9` |
| `ComplexNumberedLists.docx` | Apache POI `test-data/document/` | Apache-2.0 | `297a085a7d433af2eeee7661e8db21539452cb585096484774a1e9f5f258b0b6` |
| `FieldCodes.docx` | Apache POI `test-data/document/` | Apache-2.0 | `9247f85ab90b15f11d0cf14d0070fdcb5cdf47c65d6bc77cc32cb7ee682aad24` |
| `rtl.docx` | Apache POI `test-data/document/` | Apache-2.0 | `d159b6ac6734f14a9ecf8e97ca5029bdcddbfae2d33ba0128aa774924e0b190d` |
| `checkboxes.docx` | Apache POI `test-data/document/` | Apache-2.0 | `06f1dc1370c772a020c6d5183c8b7c4fe30ad7a9fff108cb2f027128ddf5e209` |
| `shapes-with-text.docx` | Apache POI `test-data/document/` | Apache-2.0 | `1ef4d8cbfd5e2333897ab3193b58ce445cee7e45476d39e5626a4c7097f72d95` |
| `WithGIF.docx` | Apache POI `test-data/document/` | Apache-2.0 | `fb9f0bfa791921c43fe113005d3bb7d639ab2946c082e7d24d31e0bf73003036` |
| `headerPic.docx` | Apache POI `test-data/document/` | Apache-2.0 | `50d9b17f7575c8a91129fd8a3e6a70feec886480ab9f089e29a7f8ac7e5ed51a` |

### `docx/hostile/`

Files that **must** be refused. Same sources; `corpus.test.ts` asserts the refusal.

| File | Source | Licence | SHA-256 | Why it is here |
|---|---|---|---|---|
| `ExternalEntityInText.docx` | Apache POI `test-data/document/` | Apache-2.0 | `5cf7340ffd6516c2fd168f445ff78cf64bd86409fe69db68997fc9f94820c223` | an XML external entity (XXE): a doctype that names a file |
| `deep-table-cell.docx` | Apache POI `test-data/document/` | Apache-2.0 | `31c5bfe1f68c98699cb356891de2e02fe223f633706d666c430ca79fd2cdf6bb` | nested far past anything a document has, found by a fuzzer |

### Sources

- python-docx: https://github.com/python-openxml/python-docx/tree/master/features/steps/test_files
  (commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7`, the head of `master` when they were fetched).
  MIT licence, `Copyright (c) 2013 Steve Canny`:
  https://github.com/python-openxml/python-docx/blob/master/LICENSE
- Apache POI: https://github.com/apache/poi/tree/trunk/test-data/document (commit
  `df7d70faa13003593f272259c7fe8ed787f507df`, the head of `trunk` when they were fetched).
  Apache License 2.0, `Copyright The Apache Software Foundation`:
  https://github.com/apache/poi/blob/trunk/LICENSE

Fetched on 2026-10-15 with `curl` from `raw.githubusercontent.com`, put in a directory of their
own, and opened only by the importer in this repo and, for the exports, by python-docx run with
`python -I`. Nothing in them is executed.

## Running it

```sh
npx vitest run tests/corpus                 # the importer, the exporter, the round trip, the refusals
```

`python.test.ts` needs python-docx. Without it the test says it was skipped and why; it never
passes by not running:

```sh
python3 -m venv tests/corpus/.venv
tests/corpus/.venv/bin/pip install python-docx
npx vitest run tests/corpus/python.test.ts      # or CORPUS_PYTHON=/path/to/python
python -I scripts/corpus-check.py tests/corpus/out   # the same check, by hand, after a run
```

The real page, with the local stack up (`npm run dev`, `node scripts/seed-local.mjs`):

```sh
CORPUS_PYTHON=tests/corpus/.venv/bin/python node tests/corpus/e2e-files.mjs
```

To change a generated file, edit `generate/make_python_docx.py` or `generate/make_docx_package.mjs`
and run it; the files in `docx/` are committed so the tests do not depend on either tool.

## What the round trip compares, and what it does not

Import, export, re-import, and compare the two models line by line (`helpers.ts` `outline`), with
these differences not counted, because they are not differences:

- neighbouring bullet lists are one list: the writer gives a document one bullet definition;
- a picture's placeholder number (`import:3`);
- the spacing a Word document's own defaults supply (single, 8 pt after), which a re-import reads
  back as set;
- a table of contents, which is written as its entries. File 15 is asserted separately.

Page setup, headers and footers are compared exactly. Comments are compared through
`ExportComment`, which the exporter is given the way the page gives it.

## What it does not say

**LibreOffice is not installed on the machine this was written on, so no file was rendered.**
Nothing here says what a page looks like in Word or LibreOffice, whether a table breaks where
Word would break it, or whether a font falls back well. It says the files are sound, python-docx
reads them, and what is in them is what went in. A render check is the next thing this corpus
wants, and `scripts/corpus-check.py` is where it would go.

Not read, and said so in the importer's warnings where a file has them: text boxes become
paragraphs, shapes and charts are left out, equations are text, pictures in headers are left out,
and a document has one paper size and one orientation (a later section that differs is noted).
A list that Word nests by indent alone, as separate lists, is kept as separate lists.


# The xlsx fidelity corpus

The same bar for Sheets: "does it open and save an Excel workbook properly" is a set of files.
`xlsx/corpus.test.ts` reads each one, says what must be in it, writes it back out, reads that, and compares.
`xlsx/python.test.ts` has openpyxl, a reader that is not ours, open everything we export.

```
xlsx/                  made for this corpus, one family of features each (generate/ says how), with <name>.expect.json
xlsx/real/             real workbooks written by Excel and LibreOffice that others published, below
xlsx/hostile/          files that must be refused, below
xlsx/generate/         make_openpyxl.py, make_hostile.py, copy_real.py, and check_xlsx.py (the openpyxl half of python.test.ts)
xlsx/out/              what python.test.ts exports for openpyxl to open. Git ignores it
```

## What is in `xlsx/`

Made with openpyxl, which writes what Excel writes for the things below and nothing it has not been told. openpyxl
does not calculate, so `make_openpyxl.py` works every value out in Python, writes it into the file beside its formula
(as Excel does) and into `<name>.expect.json`. A formula's answer is therefore checked against two things that are
not our code: the file's cache and the script's arithmetic.

| File | Covers |
|---|---|
| `01-values` | integers, floats, 15-digit numbers, 1e21, text of every kind (Unicode, RTL, emoji, 1,000 characters, leading zeros, a string that begins with `=`), booleans, errors, dates and times in six formats |
| `02-formulas` | 64 formulas: arithmetic, logic, lookup, text, maths, dates, cross-sheet references to sheets with spaces and quotes in their names, whole-column and whole-row ranges, a running total, the `_xlfn.` functions (IFS, SWITCH, TEXTJOIN, CONCAT), errors, and two functions the engine does not have, whose cached values must be kept |
| `03-formats` | 13 number formats, fonts, fills (RGB, theme with a tint, indexed, pattern, gradient), nine border styles, alignment, a formatted column and a formatted row |
| `04-layout` | widths (including exactly nine characters), heights, hidden rows and columns, three kinds of frozen pane, merges with their borders, tab colours (RGB and theme), a hidden sheet, sheet order |
| `05-names` | names for a range, a constant and a formula; a sheet's own names, one in two sheets; names used in formulas |
| `06-validation` | list written out, list over a range, over another sheet, whole, decimal, date, text length, custom, warning and information styles, a validation over a whole column, one over two ranges |
| `07-conditional` | 19 conditional formats: each comparison, text rules, duplicates, unique, top and bottom (count and percent), above and below average, colour scales of two and three stops, a data bar, an icon set, blanks, errors, a formula |
| `08-large` | 20,000 rows, 40,000 formulas (a running total), dates in a formatted column |
| `09-unicode-names` | sheet names with accents, an ampersand, kanji and spaces, referred to from formulas; a cell of 32,767 characters |
| `10-filter-table` | a filter with a criterion and the rows it hides; a table |
| `11-date1904` | a workbook in the Mac date system |
| `12-chart-links-notes` | a chart, four links (one `javascript:`), a note: counted and left out, the cells kept |

## What is in `xlsx/real/`

Real Excel and LibreOffice workbooks, taken unchanged from IronCalc's test suite
(https://github.com/ironcalc/IronCalc, the `ironcalc` 0.8.3 crate on crates.io), which is **MIT OR Apache-2.0**
(`Copyright Nicolás Hatcher and contributors`, as the crate's `Cargo.toml` says). The producer is read off each
file's own markers (a calculation chain and Excel's revision namespaces mean Excel; `appName="Calc"` means
LibreOffice); five carry no marker. `real/manifest.json` holds the same table and `corpus.test.ts` checks every hash.

`calc` files are ones where every formula must come out as the program that saved the file calculated it.
`gaps` files are ones where the engine is known to differ, and the test pins how many cells agree: the number only
goes up. `features` and `documents` files are read and round-tripped.

| File | Upstream path | Producer | Kind | SHA-256 |
|---|---|---|---|---|
| `SUMIFS.xlsx` | `tests/calc_tests/MATH_AND_TRIGONOMETRY/SUMIFS.xlsx` | Microsoft Excel | calc | `19d7c5cdc45635fe56dcb9b0d571b6b439a6e367683547fc5527c101b8ba2146` |
| `ROUND.xlsx` | `tests/calc_tests/MATH_AND_TRIGONOMETRY/ROUND.xlsx` | Microsoft Excel | calc | `91331a4d5ab6fbf3c82d867ef7f7419f1faf54726e01a79b70552434e0434ef1` |
| `LOG_LOG10_LN.xlsx` | `tests/calc_tests/MATH_AND_TRIGONOMETRY/LOG_LOG10_LN.xlsx` | Microsoft Excel | calc | `e7f77bccac0ecb09ddfcc30c52718670301f157f14fa80dc5bf86f52c6f1bcb6` |
| `ATAN2_POWER.xlsx` | `tests/calc_tests/MATH_AND_TRIGONOMETRY/ATAN2_POWER.xlsx` | Microsoft Excel | calc | `0a15dfcf9a924faca1d92b756bac303f42bda349a1a9204c701119174c756c55` |
| `AVERAGE.xlsx` | `tests/calc_tests/STATISTICAL/AVERAGE.xlsx` | Microsoft Excel | calc | `02da01001ff166852559633742fb29a50599aeec53ae4b3bbf0d3db105f2ffe3` |
| `COUNT.xlsx` | `tests/calc_tests/STATISTICAL/COUNT.xlsx` | Microsoft Excel | calc | `e4d5248dc099979118b9c9fcef55587eede601a554fd40c5448c8f9853dce1b7` |
| `GEOMEAN.xlsx` | `tests/calc_tests/STATISTICAL/GEOMEAN.xlsx` | unknown (the file carries no marker) | calc | `3b21c943d6f8a6ed3e61e23a0b8612ebeaf8b621e081dbc80bdeb46a60658ebd` |
| `SMALL_LARGE.xlsx` | `tests/calc_tests/STATISTICAL/SMALL_LARGE.xlsx` | Microsoft Excel | calc | `de9a0eb13c83a51685b3ec985fb97116a73077bdd095e39cae5efdff5db82ce0` |
| `RANK_EQ_RANK_AVG.xlsx` | `tests/calc_tests/STATISTICAL/RANK_EQ_RANK_AVG.xlsx` | Microsoft Excel | calc | `8e633347b197661323aa21e65470b0105cc40435394c6e06ce718f8fe51710f8` |
| `IFS.xlsx` | `tests/calc_tests/LOGICAL/IFS.xlsx` | Microsoft Excel | calc | `e45bbf01b7252386f735382e494cef8d59dc86687aeb0b5d9dd48343ed4d6e96` |
| `CONCAT.xlsx` | `tests/calc_tests/TEXT/CONCAT.xlsx` | Microsoft Excel | calc | `20305f4950842b5680d9bd07333c220b37f6e8640e2cf14ecf80c1bf5ad56ba6` |
| `CONCATENATE.xlsx` | `tests/calc_tests/TEXT/CONCATENATE.xlsx` | Microsoft Excel | calc | `8ecf30bfb65d02390d5c83c50a5fecada396c2361664eedd640fdd356766fb66` |
| `PV.xlsx` | `tests/calc_tests/FINANCIAL/PV.xlsx` | Microsoft Excel | calc | `d9f8f40ea62f8e5ceedd8c31959bef3870add624ec66fe0163a7fa32ace78f1c` |
| `NPER.xlsx` | `tests/calc_tests/FINANCIAL/NPER.xlsx` | Microsoft Excel | calc | `b196543e9b721df2d54f1525de08aa29c54143d6b2c41aaf833778b6a75dc831` |
| `XLOOKUP.xlsx` | `tests/calc_tests/LOOKUP_AND_REFERENCE/XLOOKUP.xlsx` | Microsoft Excel | gaps | `10af43589194e722ad58a82223f45bb40029d207757cd1d169f8f2a9a629fdc8` |
| `HVLOOKUP.xlsx` | `tests/calc_tests/LOOKUP_AND_REFERENCE/HVLOOKUP.xlsx` | Microsoft Excel | gaps | `fafe04dd164e13dfbe76c440a75627fc23c822342c60c67ac2bad6ef4545f9fc` |
| `DAYS_DAYS360.xlsx` | `tests/calc_tests/DATE_AND_TIME/DAYS_DAYS360.xlsx` | Microsoft Excel | gaps | `1c23bbb7443fbc151e3966c4fe1ccab6b483463870b1771d5397ea957652c7d8` |
| `SUMIF_AVERAGE_IF.xlsx` | `tests/calc_tests/MATH_AND_TRIGONOMETRY/SUMIF_AVERAGE_IF.xlsx` | Microsoft Excel | gaps | `62666c82ed33ebf59bd1cfc6c765b1a0b3a784152b39b688aa2fa6c603c1b37e` |
| `freeze.xlsx` | `tests/freeze.xlsx` | Microsoft Excel | features | `88a3ca6d8ecad5953dc82b08230b056b1263c4c6cabf7b3e2894cfe4cdcd5755` |
| `split.xlsx` | `tests/split.xlsx` | Microsoft Excel | features | `0afc38b7b8e9fe2b5bebf0c14c873ce2bc40d7960d4a79865d8fd7df7d12ff97` |
| `custom_theme_colors.xlsx` | `tests/custom_theme_colors.xlsx` | Microsoft Excel | features | `43d177a5a164774dd010810070dafab821083b3e00f2f6f311e774a5bbb58e51` |
| `cf_tests.xlsx` | `tests/conditional_formatting/cf_tests.xlsx` | Microsoft Excel | features | `6d47b1be1937274929ba7ed1239deae3c2ac0bf9781037c4190e605110508888` |
| `libreoffice_888_example.xlsx` | `tests/libreoffice_888_example.xlsx` | LibreOffice Calc | features | `5e87be8a402033de7c514162f49071ab3b3acdd3ff49504a036e4a881c393c2d` |
| `openpyxl_example.xlsx` | `tests/openpyxl_example.xlsx` | openpyxl | features | `f33914b87aaf76ad49622499b5ce48bf07646456a40d6b559db4cede6ece7b1a` |
| `shared_formula_volatile.xlsx` | `tests/shared_formula_volatile.xlsx` | unknown (the file carries no marker) | features | `014491e448750e458f9a7a239876d87a1ff77222ae9e9188ac74cd00e8342e26` |
| `missing_r_on_row.xlsx` | `tests/missing_r_on_row.xlsx` | unknown (the file carries no marker) | features | `9de7a98a91b60a51cb52d745f193d6d44f11ad16ac2a2b07da5466544cd726c1` |
| `optional_xf_id.xlsx` | `tests/optional_xf_id.xlsx` | unknown (the file carries no marker) | features | `1fa8f71de1056696578cf77e184c606696cd72887ee5b05b34f8d82bfa1645f4` |
| `example.xlsx` | `tests/example.xlsx` | Microsoft Excel | features | `35010189f3dbd9ec1881749cb1995d55fe35b7f3a9c07d6198abc55218bbc445` |
| `tables.xlsx` | `tests/calc_test_no_export/tables.xlsx` | Microsoft Excel | features | `d603afdea61b0809f92561a55b202956f8b46f80235652cf6ef702f995993615` |
| `NoGrid.xlsx` | `tests/NoGrid.xlsx` | Microsoft Excel | features | `76501cecd5cde8d8968e8fefb4a359fd8d8728f42e9c870b43d974fb6bc1d3c8` |
| `basic_text.xlsx` | `tests/basic_text.xlsx` | unknown (the file carries no marker) | features | `a916fdfcd4f3e5558b8e77d986140e7c20c541e5b63b5cabe25d7adad5af8d5c` |
| `invoice.xlsx` | `tests/templates/invoice.xlsx` | Microsoft Excel | documents | `7879d312f90fafb497b0f45115186a23730a92d44d1e914b8c2c492460ffcd39` |
| `weekly_timesheet.xlsx` | `tests/templates/weekly_timesheet.xlsx` | Microsoft Excel | documents | `4deed2bd9a9fb330d5285709da903320880c54c198783cfcb00643c2e6145364` |
| `travel_expenses_tracker.xlsx` | `tests/templates/travel_expenses_tracker.xlsx` | Microsoft Excel | documents | `829e06370ddab439610be9456580f0f01c40ce8bd42949a6ce220bafbf55a05d` |
| `gantt_project_tracker.xlsx` | `tests/templates/gantt_project_tracker.xlsx` | Microsoft Excel | documents | `771c40af914a51f11633ae24fa3f365549a4d32bac83c7c189e15f36c9310927` |
| `yearly_calendar.xlsx` | `tests/templates/yearly_calendar.xlsx` | Microsoft Excel | documents | `e0887f733ff6262890f16bce11ff4920d88b1b9f0646a8be9ca257c82ac12f40` |
| `event_calendar.xlsx` | `tests/templates/event_calendar.xlsx` | Microsoft Excel | documents | `2d2aadbbb7f2e91278e5d225c040497e2c7d05445cc38ae36c01d551df74fdc7` |

They were taken from the crate's source in the local cargo registry (`ironcalc-0.8.3/tests/`), put in a directory of
their own, and opened only by the importer in this repo and, for the exports, by openpyxl run with `python -I`.
Nothing in them is executed. To fetch them again: `python -I xlsx/generate/copy_real.py PATH/TO/ironcalc-0.8.3/tests`.

### `xlsx/hostile/`

Files that **must** be refused. `make_hostile.py` makes both; `corpus.test.ts` asserts the refusal. The ranges
that are valid and hostile (a validation over every cell, a merge of the whole sheet, a column definition that runs to
the 2,000,000,000th) are built inside `formats/security.test.ts`, where each is timed.

| File | Why it is here |
|---|---|
| `zip-bomb.xlsx` | 72 KiB that declare 72 MiB of sheet. The directory says so before anything is inflated |
| `entity-declaration.xlsx` | a DOCTYPE with the billion laughs, and an external entity that names a file on the reader's disk |

## Running it

```sh
npx vitest run tests/corpus/xlsx            # the importer, the exporter, the round trip, the refusals
```

`xlsx/python.test.ts` needs openpyxl. Without it the test says it was skipped and why; it never passes by not running:

```sh
python3 -m venv tests/corpus/.venv
tests/corpus/.venv/bin/pip install openpyxl     # python-docx too, for the docx half
npx vitest run tests/corpus/xlsx/python.test.ts # or CORPUS_PYTHON=/path/to/python
```

To change a generated file, edit `xlsx/generate/make_openpyxl.py` and run `python -I make_openpyxl.py .` from `xlsx/`;
the files are committed so the tests depend on neither the script nor openpyxl.

## What the round trip compares, and what it does not

Import, export, import again, and compare the two workbooks position by position (`dumpWorkbook` in
`web/src/formats/xlsx/testing.ts`): every value and formula, every format, the sizes, the hidden lines, the frozen
panes, the merges, the names, the rules, the filter. These are not counted as differences, because they are not:

- a vertical alignment of "middle" and Excel's own default font, which the grid and every workbook assume;
- the values under a merge, which the file does not hold;
- a validation over two ranges, which a file keys by range and so comes back as two;
- a cell whose answer is the clock's (`NOW`, `TODAY`, `RAND`).

A rule says the same thing in a file in more than one way, so a text rule, a blank rule or a duplicates rule that comes
back as Excel's formula form is read as the rule it is.

## What it does not say

**LibreOffice is not installed on the machine this was written on, so no file was rendered.** Nothing here says
what a sheet looks like in Excel or LibreOffice, whether a conditional format colours the cell it should, or whether
Excel opens an export without offering to repair it. It says the files are sound, openpyxl reads them, and what is in
them is what went in. Excel's own cached answers for a formula are checked against the engine where the file came from
Excel; the others are checked against arithmetic done in Python.

Not read, and said so in the importer's warnings where a file has them: charts, pictures, comments and notes, links,
pivot tables (their cells stay), tables (their cells stay), macros, links to other workbooks, sparklines, icon sets,
gradient fills, a filter's criteria (its range and the rows it hid stay), rotated text. A formula the engine cannot
calculate keeps the value the file gave it. A formula it can calculate differently from Excel is a bug in the engine,
and `gaps` files are where they are found.
