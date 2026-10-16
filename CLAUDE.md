# office-apps

Office: Docs, Sheets and Slides as an offline desktop app. The React app in `web/` runs in a
PySide6 / Qt WebEngine shell in `shell/`. Read `HANDOFF.md` first. Write in British English.

## Two kinds of code, and the `base` branch

Most of `web/src` (the editors, the converters, the shell UI) and `tests/corpus` arrive on the
**`base` branch**, which is only ever updated by a tool, with the commit message `Update base`, and
merged into the work. **Never commit to `base` by hand**, and keep edits to files that come from it
as small as possible: every one is a merge conflict the next time `base` moves.

The app's own code, edited freely:

- `web/src/desktop/**`: the host bridge, the native file, sessions, Start, the editor windows, a
  deck's pictures and the presenter's audience window.
- `shell/**`, `e2e/**`, `.github/**`, `LICENSES/**`, the root configs and docs.
- Owned replacements of base files: `web/src/main.tsx`, `web/src/state.tsx` (no accounts: `me` is
  null), `web/src/core/LockDialogs.tsx` (stubs), `shared/branding.ts` (a type), `web/index.html`,
  `web/public/favicon.svg`, `web/public/fonts/fonts.css`, and the four token files
  `web/public/_ds/base/tokens/{colors,fonts,typography,base}.css`.

The edits to base files, all of them; add to this list if you must add one:

1. `web/src/router.tsx`: `setNavigationGuard`, checked first in `navigate()`.
2. `web/src/core/prefetch.ts`: loads `desktop/LocalDocsPage`, `LocalSheetsPage` and `LocalSlidesPage`.
3. `web/src/docs/modules/index.ts`: `desktopDocsModule` appended.
4. `web/src/sheets/modules/index.ts`: `desktopSheetsModule` appended.
5. `web/src/sheets/useDocumentActions.ts`: a `local` flag; a local rename does not call the server.
6. `web/src/sheets/SheetsEditor.tsx`: passes `source.kind === 'local'` to it.
7. `web/src/slides/SlidesEditor.tsx`: the same, for Slides.
8. `web/src/slides/modules/index.ts`: `desktopSlidesModule` appended.
9. `web/src/slides/render/assets.tsx`: `setLocalAssets`; `documentAssets` asks it first.
10. `web/src/slides/modules/insert/picture.ts`: `setPictureUpload` replaces the upload step.
11. `web/src/slides/modules/files.tsx`: PowerPoint export reads a local deck's pictures too.

Code from `base` that needs a server (sharing, comments, history, `client.ts`, `docs/room.ts`) is
kept as it is and never reached: the editors hide it when `source.features` says there is no
server. Do not delete it to tidy up; that turns every later merge into a conflict.

## Nothing leaves the app

Three layers, keep all three: the shell's request interceptor blocks every scheme but `app:`,
`data:`, `blob:` and `about:` (`shell/officeapps/app.py`); the scheme handler fails `/api/*`
(`scheme.py`); the built page's CSP says `connect-src 'self'` (`vite.config.ts`). The e2e walk and
the self-test both fail on a request that leaves the app.

## The bridge

`web/src/desktop/host.ts` is the contract; `qtHost.ts` speaks it to `shell/officeapps/bridge.py`,
whose methods are `DocumentWindow.js_*` in `window.py`, and `fakeHost.ts` stands in for it in a
browser. Change all three together. The page never gets a path it did not get from the shell, and
a path from the page is honoured only if it is in the recent list.

`web/src/desktop/kinds.ts` and `shell/officeapps/kinds.json` describe the same kinds;
`kinds.test.ts` fails when they differ. The `.oadoc` / `.oasheet` / `.oadeck` file is a zip
(`container.ts`); bump `VERSION` there only with a reader for the old one.

## Slides

A slide names a picture by an asset id, which upstream of this app is a server's. Here the id names
a picture in the window's `PictureStore` (`desktop/pictures.ts`), drawn from a `blob:` address and
saved in the file's `pictures/` beside the deck; hunks 9 and 10 point the editor at it
(`desktop/slidesPictures.ts`). Only the pictures the deck still names are saved. Upstream shows
Insert → Picture only on a server (its tests pin that), so `desktop/slidesModule.tsx` adds the
same button in the same place; a slide background's Picture… stays hidden.

Presenter view opens a second window with `window.open`. The shell turns that into an audience
window (`DocumentWindow(audience=True)`, `Page._on_new_window`), and the presentation's window
feeds it the deck over a BroadcastChannel (`desktop/deckMirror.ts`): it has no file of its own.
A slide show asks for full screen, and the shell puts its window there (`set_page_full_screen`).

## Saving

A file with a path saves itself (`session.ts`, on `core/savequeue.ts`) 1.5 s after the last edit,
when the window goes to the back, and before it closes. A new document has no file until Save asks
where; closing it after an edit asks first (the shell's `ask_keep`). The shell writes atomically,
keeps backups in the app's data folder, and refuses a save over a file another app changed (`stale`)
unless the person chooses to keep their version.

## Tests

- `npm test`: vitest, Node, the editors' tests and the desktop layer's. In a British locale (the
  script sets `LANG`): a test expects A4 paper.
- `npm run e2e`: the built app in Chromium on the fake host.
- `python -m pytest -q shell`: the shell's files, scheme and kinds.
- `python -m officeapps --self-test` (from `shell/`): the real app, windows and all. Needs a display
  (`xvfb-run -a` on Linux). CI runs it on Linux and inside the built `.app` on macOS.

When running as root on Linux, QtWebEngine needs `QTWEBENGINE_DISABLE_SANDBOX=1`.

A Mac's disk ignores case and Linux's does not: `vite.exact-case.ts` makes `./Picker` mean
`Picker.tsx` and never `picker.ts` on both. Keep it in `plugins` and in `worker.plugins`.

## Copy

Sentence case; verbs on buttons; say it once. No product names but Office, Docs, Sheets and Slides.

## Handing off

`HANDOFF.md` is overwritten, not appended: what the last session did and what the next one needs.
