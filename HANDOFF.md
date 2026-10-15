# Handoff

Written 2026-10-15, at the first version. Overwrite it; do not append.

## Where it stands

Docs and Sheets run offline as a desktop app: the React editors on a local source, in a PySide6 6.12
shell with one window per document and a Start window.

| Check | Result (Linux container) |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 137 files; all pass |
| `npm run build` | clean, 9 MB |
| `npm run e2e` | 8 of 8 |
| `pytest shell` | 8 of 8 |
| `--self-test` under Xvfb | 10 of 10: save, autosave, reopen, template, docx import with pictures and export, sheet formula save and xlsx/csv export, Qt keyboard into the grid, print to PDF, clipboard, the close prompt, no network |
| The PyInstaller build of `shell/packaging/office.spec` on Linux, self-test inside it | 10 of 10; 421 MB (Qt WebEngine is 195 MB of it) |

**CI.** `ci.yml` (Linux: typecheck, tests, build, the browser walk, the shell's tests and self-test) is
green on GitHub. Sessions here cannot push to `.github/workflows/` (no `workflow` permission); the
owner moves workflow changes in by hand.

**The first macOS run** stopped in `vite build`: `web/src/docs/core/` has `Picker.tsx` and `picker.ts`,
and on a case-insensitive disk `import './Picker'` found `picker.ts`. `vite.exact-case.ts` resolves
relative imports by their exact case, in the page's bundle and the workers'. Its next run is the
first to reach PyInstaller on macOS.

**Not yet seen on a Mac.** `macos.yml` builds `Office.app` with PyInstaller on `macos-15`, signs it
ad hoc, runs the self-test inside it and makes the dmg; its first run is the first time any of that
has happened on macOS. The same spec builds and passes on Linux, so what is left to find is
Mac-specific: the QtWebEngine helper inside the frameworks, signing, and the minimum macOS version
(`LSMinimumSystemVersion` is 13.0; the job prints QtCore's `minos`, which wins if it is higher). The
spec drops Qt modules the app does not load (`KEEP_QT`); a missing one shows as a crash at start.

## What to check on a real Mac (nobody has)

- **Keys.** Each must act once: in Docs ⌘C ⌘X ⌘V ⌘A ⌘Z ⇧⌘Z ⌘B ⌘K ⌘F ⌘P; in the Sheets grid ⌘C ⌘X
  ⌘V (also pasting from another app) ⌘A ⌘Z; in the formula bar, a cell being edited, the title and
  the ⌘K box. QtWebEngine gives an editing key to the page in an editable field and to the menu bar
  elsewhere (the grid is not editable), which `menus.py` relies on. If one acts twice or not at
  all: take that item's shortcut off the menu, or route the grid's copy and paste to the editor's
  `edit.copy` / `edit.cut` / `edit.paste` commands.
- **Finder.** Double-clicking a `.oadoc` with the app closed and open; a `.docx` via Open With;
  dropping on the Dock icon (`QFileOpenEvent`, buffered in `Application.event`).
- **Close and quit.** ⌘W and ⌘Q with a dirty untitled document (a sheet asks), and with a dirty
  saved one (it saves and closes); the Dock's Quit and logging out take the same path.
- **Print** opens the native panel (`QPrintDialog`, `view.print`); only print to PDF was run here.
- Export opens a save panel, and the files open in Pages, Numbers, Word and Excel.

## Choices, and why

- **Files.** The app's own `.oadoc` / `.oasheet` (a zip: manifest, Yjs state, Sheets' cell list)
  is lossless; Word and Excel go through Open (as a new, untitled document) and Export. The xlsx
  writer drops charts, which is why a workbook is not saved as xlsx.
- **Editors untouched.** The cloud code stays in the tree, unreachable; see `CLAUDE.md`.
- **PySide6, not C++.** It runs here under Xvfb on the same Qt the Mac build uses, so the shell is
  tested before a Mac sees it.
- **`app://local/`, not `file://`.** Module workers (the converters), `pushState`, `localStorage`
  and the async clipboard need a real origin.

## Half-done and known gaps

- Slides is not built (`kinds.ts` / `kinds.json` have it disabled). When it arrives it needs a
  `LocalSlidesPage`, a `slidesModule`, its route in `desktop/App.tsx`, `enabled: true` in both kinds
  files, and its document type in the spec.
- Comments, suggestions and version history are hidden: they live on a server upstream.
- Untitled documents are not autosaved anywhere; a crash loses them. A drafts folder would fix it.
- Bytes cross the bridge as base64; a 20 MB workbook has not been timed.
- The app is signed ad hoc, so Gatekeeper asks once (README). Notarising needs a Developer ID.
- `npm test` excludes two ExcelJS test files from `tsc` only (their `Buffer` typing); vitest runs them.
