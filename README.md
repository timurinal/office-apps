# Office

Docs, Sheets and Slides on your Mac, offline: no account, no server, your files on your disk.

It is a web app (React, in `web/`) running in a small Qt shell (`shell/`, PySide6 and Qt WebEngine),
so it looks and behaves the same everywhere, and the shell gives it real windows, menus and files.

## Installing it (macOS, Apple Silicon)

1. Get `Office-<version>-arm64.dmg`: from the repository's Releases, or from the latest **macOS
   app** run under Actions (the `Office-macOS-arm64` artefact).
2. Open it and drag **Office** to **Applications**.
3. The first time, macOS refuses to open it, because it is not signed by an identified developer.
   Open **System Settings → Privacy & Security**, scroll down, and choose **Open Anyway**. Or, in
   Terminal: `xattr -dr com.apple.quarantine /Applications/Office.app`.

## Files

| | Its own file | Opens (as a new document) | Exports |
|---|---|---|---|
| Docs | `.oadoc` | Word `.docx`, Markdown, HTML, plain text | Word, Markdown, HTML, plain text, PDF (Print) |
| Sheets | `.oasheet` | Excel `.xlsx`, CSV, tab-separated | Excel, CSV, tab-separated |
| Slides | `.oadeck` | PowerPoint `.pptx`, `.ppsx`, `.potx` | PowerPoint |

The app's own files keep everything exactly; save one and it saves itself as you work (the footer
says *Saved*). A Word or Excel file opens as a new document; File → Export writes one back out.
Backups of the last ten versions of each file are kept in
`~/Library/Application Support/Office/Backups`.

## Presenting

**Present** (or F5) plays the slides full screen; Escape ends it. **Presenter view** keeps the
notes, the next slide and a timer in the presentation's window and opens a second window for the
audience: move that one to the projector and press F there for full screen.

## Working on it

```sh
npm install
npm run dev            # the app in a browser, with a stand-in for the shell (files in IndexedDB)
npm run typecheck
npm test               # vitest: the editors, the converters, the desktop layer
npm run build          # dist/web
npm run e2e            # the app in Chromium against the build, end to end

python3 -m venv .venv && .venv/bin/pip install -r shell/requirements-dev.txt
.venv/bin/python -m pytest -q shell                       # the shell's own tests
cd shell && ../.venv/bin/python -m officeapps --web-dir ../dist/web   # the real app
```

`--devtools` opens Chromium's inspector beside each window. `--self-test` drives the real app
through its windows, files and menus and exits 0 when everything worked (CI runs it on Linux and,
inside the built `.app`, on macOS); on Linux it needs a display, e.g. `xvfb-run -a`.

### Building the Mac app

CI does this (`.github/workflows/macos.yml`): run it from the Actions tab, or push a `v*` tag for a
release. By hand, on a Mac:

```sh
npm ci && npm run build
python3 -m venv .venv && .venv/bin/pip install -r shell/requirements-dev.txt
sh shell/packaging/make_icons.sh
.venv/bin/pyinstaller --noconfirm --distpath dist/mac --workpath build/pyinstaller shell/packaging/office.spec
codesign --force --deep --sign - dist/mac/Office.app
sh shell/packaging/make_dmg.sh dist/mac/Office.app dist/Office.dmg
```

## Layout

```
web/src/              the editors (docs/, sheets/, slides/), their converters (formats/), the shell UI (core/)
web/src/desktop/      the desktop layer: the host bridge, the file format, Start, the editor windows
shell/officeapps/     the Qt shell: the app:// scheme, windows, menus, the bridge, files, self-test
shell/packaging/      PyInstaller spec, icon, disk image
e2e/                  the browser walk
tests/corpus/         Word, Excel and PowerPoint files the converters are tested against
LICENSES/             third-party licences
```
