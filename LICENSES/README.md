# Third-party software in Office

The app is built from these, under these licences. The texts are in this folder; the JavaScript
packages bundled into the web app are listed, each with its licence, in `THIRD_PARTY.txt` beside
the app's `index.html` (written by the build).

| Component | Licence | Text |
|---|---|---|
| Qt 6 and Qt WebEngine (which includes Chromium), through PySide6 | LGPL-3.0 | `LGPL-3.0.txt`, `GPL-3.0.txt` |
| PySide6 and Shiboken6 | LGPL-3.0 | `LGPL-3.0.txt` |
| Inter (typeface) | SIL Open Font License 1.1 | `Inter-OFL.txt` |
| JetBrains Mono (typeface) | SIL Open Font License 1.1 | `JetBrainsMono-OFL.txt` |
| Phosphor Icons | MIT | `Phosphor-MIT.txt` |

Qt and PySide6 are used unmodified, as the shared libraries and frameworks inside the app bundle
(`Office.app/Contents/Frameworks`); they can be replaced with other builds of the same version.
Their source is at https://code.qt.io and https://download.qt.io.
