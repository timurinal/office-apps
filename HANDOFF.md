# Handoff

Written 2026-10-16, after the port that followed Slides. Overwrite it; do not append.

## Where it stands

Docs, Sheets and Slides run offline as a desktop app: the React editors on a local source, in a
PySide6 6.12 shell with one window per document and a Start window.

| Check (Linux container) | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 223 files, 4125 tests; all pass |
| `npm run build` | clean |
| `npm run e2e` | 13 of 13, five of them Slides: new, a picture from a file, template, PowerPoint with pictures, presenter view |
| `pytest shell` | 8 of 8 |
| `--self-test` under Xvfb | 13 of 13; new for Slides: type, add a picture through Insert → Picture and the open panel, save and reopen; F5 taking the screen and Escape giving it back; presenter view's audience window showing the deck and closing when the show ends; a pptx with pictures saved, reopened and exported |

## Since then

A second port brought upstream's light and dark appearance (View → Appearance, kept in
`localStorage` and settled before paint by `web/public/theme-init.js`, which now comes with
`base`), a context menu and dropdowns of its own, carets beside the text, and a one-row ribbon. The
fork mirrored `index.html`, `main.tsx` (`initAppearance`, the toast's editor colour) and the dropped
`@tiptap/extension-collaboration-caret`. Nobody has looked at Dark on a Mac: QtWebEngine's
`prefers-color-scheme` should follow the system's setting, which is what System means here.

## What the Slides session did

- **Slides.** `desktop/LocalSlidesPage.tsx` opens a blank, a template, an `.oadeck` or a PowerPoint
  file (`.pptx`, `.ppsx`, `.potx`); `slidesModule.tsx` adds the save state and the File rows. Five
  new hunks in base files, 7 to 11 in `CLAUDE.md`.
- **Pictures** live in the window's `PictureStore` and in the file's `pictures/`, not in the Yjs
  state, because the editor and its model only take asset ids (`slides/model/safe.ts`). The
  container now allows 4096 entries (it was 16). Insert → Picture is the desktop module's (upstream
  shows its own only on a server).
- The browser walk had no Slides; the self-test can now click like a person (`SelfTest.click`) and
  answer the open panel (`Page.chooseFiles`).
- **Presenter view.** The audience window is a second `DocumentWindow(audience=True)`, opened from
  the page's `window.open`; the presenter's window feeds it the deck over a BroadcastChannel.
- **Full screen** is on in the profile; the shell puts the window in full screen when a show asks,
  and tells the page when the window leaves it another way.
- **New blank decks start in Harbour**, not the theme list's first one: that one (upstream's
  default) is the old brand's violet and teal, renamed Violet by the port. It is still in the gallery.
- `--data-dir` is made absolute: a relative one (what `npm run selftest` passes) broke every save
  in the self-test, because the web profile's storage was relative.

## What to check on a real Mac (nobody has)

Everything in the last handoff still stands (keys in Docs and the Sheets grid, Finder, close and
quit, print, export). For Slides, also:

- **Present** and F5 go full screen in a Space of their own; Escape and the green button both come
  back, and the show ends with either.
- **Presenter view on two displays**: the audience window opens, can be dragged to the second
  display, and F there makes it full screen on that display. Ending the show closes it.
- ⌘C ⌘X ⌘V ⌘Z on the canvas and in a text box act once (the canvas is not editable, so the menu
  takes them, as for the Sheets grid).
- Insert → Picture opens the Mac's open panel, and the picture is in the saved file.
- Finder: a `.pptx` offers Office under Open With; an `.oadeck` opens in it.

## Half-done and known gaps

- `formats/security.test.ts`'s "fifty thousand shapes … under two seconds" took 2.1 s once in a full
  parallel run here and passes alone; on a loaded CI runner it may fail. It is upstream's test.
- A slide's background picture (Design → Background → Picture…) is hidden: upstream shows it only
  on a server, and showing it here is a hunk plus a change to upstream's test. Worth doing if asked.
- The audience window is fed by its presentation's window and has nothing of its own once that
  one closes.
- Slides' version history, comments and sharing are hidden, as for Docs and Sheets.
- Untitled documents are not autosaved anywhere; a crash loses them. A drafts folder would fix it.
- Bytes cross the bridge as base64; a deck with 50 MB of photographs has not been timed.
- The app is signed ad hoc, so Gatekeeper asks once (README). Notarising needs a Developer ID.
- `npm test` excludes two ExcelJS test files from `tsc` only (their `Buffer` typing); vitest runs them.

## Choices, and why

- **Files.** The app's own `.oadoc` / `.oasheet` / `.oadeck` (a zip: manifest, Yjs state, Sheets'
  cell list, Slides' pictures) is lossless; Word, Excel and PowerPoint go through Open (as a new,
  untitled document) and Export.
- **Editors untouched** but for the hunks; the cloud code stays in the tree, unreachable.
- **PySide6, not C++.** It runs here under Xvfb on the same Qt the Mac build uses.
- **`app://local/`, not `file://`.** Module workers, `pushState`, `localStorage`, BroadcastChannel
  and the async clipboard need a real origin.
- **CI.** Sessions here cannot push to `.github/workflows/`; the owner moves workflow changes in.
