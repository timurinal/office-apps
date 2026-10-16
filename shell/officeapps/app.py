"""
The application: its windows, its web profile, and the things no one window owns.

    python -m officeapps [--web-dir DIR] [--data-dir DIR] [--devtools] [--self-test ...] [FILE ...]

One window per document, and a Start window. On macOS the app stays open with no windows, and
coming back to it shows Start; elsewhere closing the last window quits. A file handed over by
Finder (double-click, the Dock, "Open With") arrives as a `QFileOpenEvent`, possibly before the
event loop runs, and is opened once it does.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from typing import TYPE_CHECKING

from PySide6.QtCore import QEvent, QFile, QIODevice, QSettings, QStandardPaths, Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QDesktopServices, QIcon
from PySide6.QtWebEngineCore import (
    QWebEngineDownloadRequest,
    QWebEngineProfile,
    QWebEngineSettings,
    QWebEngineUrlRequestInfo,
    QWebEngineUrlRequestInterceptor,
)
from PySide6.QtWidgets import QApplication, QFileDialog, QMenu, QMessageBox

from . import APP_NAME, BUNDLE_ID, __version__
from .files import Backups, Recents
from .kinds import classify, open_filter
from .scheme import SCHEME, SchemeHandler, register_scheme

if TYPE_CHECKING:
    from .selftest import SelfTest
    from .window import DocumentWindow

ALLOWED_SCHEMES = {"app", "data", "blob", "about"}


def bundled_web_dir() -> str:
    """Where the built web app is: inside the frozen app, or `dist/web` beside the sources."""
    frozen = getattr(sys, "_MEIPASS", None)
    if frozen:
        return os.path.join(frozen, "web")
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "dist", "web"))


class Interceptor(QWebEngineUrlRequestInterceptor):
    """Nothing leaves the app: every request that is not the app's own scheme is blocked."""

    def __init__(self, extra_origin: str | None = None, parent=None):
        super().__init__(parent)
        self.extra = extra_origin

    def interceptRequest(self, info: QWebEngineUrlRequestInfo) -> None:  # noqa: N802
        url = info.requestUrl()
        if url.scheme() in ALLOWED_SCHEMES:
            return
        if self.extra and url.toString().startswith(self.extra):
            return
        if url.scheme() == "devtools":
            return
        info.block(True)


class Application(QApplication):
    def __init__(self, argv: list[str]):
        super().__init__(argv)
        self.manager: Manager | None = None
        self.pending_files: list[str] = []

    def event(self, e: QEvent) -> bool:
        if e.type() == QEvent.Type.FileOpen:
            path = e.file()  # type: ignore[attr-defined]
            if self.manager:
                self.manager.open_path(path)
            else:
                self.pending_files.append(path)
            return True
        if e.type() == QEvent.Type.Quit and self.manager and not self.manager.quit_ready:
            # The Dock's Quit or logging out: walk the windows first, as ⌘Q does.
            e.ignore()
            self.manager.request_quit()
            return True
        return super().event(e)


class Manager:
    def __init__(self, app: Application, web_dir: str, data_dir: str, devtools: bool = False, selftest: "SelfTest | None" = None):
        self.app = app
        self.web_dir = web_dir
        self.data_dir = data_dir
        self.devtools = devtools
        self.selftest = selftest
        self.windows: list[DocumentWindow] = []
        self.start: DocumentWindow | None = None
        self.quitting = False
        self.quit_ready = False
        self.last_export_dir = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.DocumentsLocation) or os.path.expanduser("~")
        self.last_save_dir = self.last_export_dir
        os.makedirs(data_dir, exist_ok=True)
        self.recents = Recents(os.path.join(data_dir, "recents.json"))
        self.backups = Backups(os.path.join(data_dir, "Backups"))

        self.profile = QWebEngineProfile("Office", app)
        self.profile.setPersistentStoragePath(os.path.join(data_dir, "WebEngine"))
        self.profile.setCachePath(os.path.join(data_dir, "WebEngine", "Cache"))
        self.profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.MemoryHttpCache)
        self.profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies)
        self.scheme_handler = SchemeHandler(web_dir, app)
        self.profile.installUrlSchemeHandler(SCHEME, self.scheme_handler)
        self.interceptor = Interceptor(parent=app)
        self.profile.setUrlRequestInterceptor(self.interceptor)
        s = self.profile.settings()
        A = QWebEngineSettings.WebAttribute
        for attr, on in [
            (A.JavascriptCanAccessClipboard, True),
            (A.JavascriptCanPaste, True),
            (A.LocalStorageEnabled, True),
            (A.NavigateOnDropEnabled, False),
            (A.PluginsEnabled, False),
            (A.PdfViewerEnabled, False),
            (A.ErrorPageEnabled, False),
            (A.FullScreenSupportEnabled, True),
            (A.LocalContentCanAccessRemoteUrls, False),
            (A.LocalContentCanAccessFileUrls, False),
            (A.JavascriptCanOpenWindows, True),
        ]:
            s.setAttribute(attr, on)
        self.profile.downloadRequested.connect(self.on_download)

        self.channel_script = self._channel_script()
        self.printers: list = []

    @staticmethod
    def _channel_script() -> str:
        f = QFile(":/qtwebchannel/qwebchannel.js")
        if not f.open(QIODevice.OpenModeFlag.ReadOnly):
            raise RuntimeError("qwebchannel.js is missing from QtWebChannel")
        js = bytes(f.readAll().data()).decode("utf-8")
        f.close()
        return js + "\nwindow.__desktopHost = new Promise(function (r) { new QWebChannel(qt.webChannelTransport, function (c) { r(c.objects.host); }); });\n"

    # ── windows ─────────────────────────────────────────────────────────────

    def _make(self, open_request: dict | None) -> "DocumentWindow":
        from .window import DocumentWindow

        w = DocumentWindow(self, open_request)
        self.windows.append(w)
        if self.devtools:
            self._attach_devtools(w)
        w.show()
        w.raise_()
        w.activateWindow()
        return w

    def open_audience(self, request, opener: "DocumentWindow") -> "DocumentWindow":
        """The audience's window of a presenter's view: the page the presentation's window asked for."""
        from .window import DocumentWindow

        w = DocumentWindow(self, None, audience=True)
        self.windows.append(w)
        if self.devtools:
            self._attach_devtools(w)
        request.openIn(w.page)
        geo = request.requestedGeometry()
        if not QSettings().contains(w._settings_key()) and geo.width() > 0 and geo.height() > 0:
            w.resize(geo.width(), geo.height())
        w.show()
        w.raise_()
        w.activateWindow()
        return w

    def show_start(self) -> "DocumentWindow":
        if self.start is not None:
            self.start.show()
            self.start.raise_()
            self.start.activateWindow()
            return self.start
        self.start = self._make(None)
        return self.start

    def _leave_start(self, origin: "DocumentWindow | None") -> None:
        if origin is not None and origin is self.start:
            self.start.hide()

    def new_document(self, kind: str, template_id: str | None, origin: "DocumentWindow | None" = None) -> "DocumentWindow":
        req = {"kind": kind, "source": "template", "templateId": template_id} if template_id else {"kind": kind, "source": "new"}
        w = self._make(req)
        self._leave_start(origin)
        return w

    def open_dialog(self, parent: "DocumentWindow | None" = None) -> None:
        path, _ = QFileDialog.getOpenFileName(parent, "Open", self.last_save_dir, open_filter())
        if path:
            self.open_path(path, origin=parent)

    def open_path(self, path: str, origin: "DocumentWindow | None" = None) -> "DocumentWindow | None":
        path = os.path.abspath(path)
        existing = self.window_for_path(path)
        if existing is not None:
            existing.show()
            existing.raise_()
            existing.activateWindow()
            return existing
        what = classify(path)
        if what is None:
            QMessageBox.information(None, APP_NAME, "That kind of file cannot be opened here.")
            return None
        if not os.path.isfile(path):
            QMessageBox.information(None, APP_NAME, "That file is not there any more.")
            self.recents.remove(path)
            self.recents_changed()
            return None
        kind, native = what
        self.last_save_dir = os.path.dirname(path)
        w = self._make({"kind": kind.id, "source": "file" if native else "import", "path": path, "name": os.path.basename(path)})
        self._leave_start(origin)
        return w

    def window_for_path(self, path: str) -> "DocumentWindow | None":
        path = os.path.abspath(path)
        for w in self.windows:
            if w.path == path:
                return w
        return None

    def window_activated(self, w: "DocumentWindow") -> None:
        pass

    def window_closed(self, w: "DocumentWindow") -> None:
        if w in self.windows:
            self.windows.remove(w)
        if w is self.start:
            self.start = None
        if self.quitting:
            QTimer.singleShot(0, self._continue_quit)
            return
        if not self.windows and sys.platform != "darwin" and self.selftest is None:
            QTimer.singleShot(0, self._really_quit)

    def visible_windows(self) -> list["DocumentWindow"]:
        return [w for w in self.windows if w.isVisible()]

    # ── quitting ────────────────────────────────────────────────────────────

    def request_quit(self) -> None:
        self.quitting = True
        self._continue_quit()

    def _continue_quit(self) -> None:
        if not self.quitting:
            return
        if not self.windows:
            self._really_quit()
            return
        # Documents first, the dirty ones raised and asked about one at a time; Start last.
        order = sorted(self.windows, key=lambda w: (w.is_start, not w.state.get("dirty")))
        order[0].close()

    def quit_cancelled(self) -> None:
        self.quitting = False

    def _really_quit(self) -> None:
        self.quit_ready = True
        self.app.quit()

    # ── recents ─────────────────────────────────────────────────────────────

    def note_recent(self, path: str, kind: str) -> None:
        self.recents.add(path, kind)
        self.recents_changed()

    def recents_changed(self) -> None:
        for w in self.windows:
            if w.is_start and w.js_ready:
                w.send("recentsChanged")

    def fill_recent_menu(self, menu: QMenu, win: "DocumentWindow") -> None:
        menu.clear()
        items = [r for r in self.recents.listing() if r["exists"]]
        for r in items[:12]:
            a = QAction(r["name"], menu)
            a.setToolTip(r["path"])
            a.triggered.connect(lambda _=False, p=r["path"]: self.open_path(p, origin=win))
            menu.addAction(a)
        if items:
            menu.addSeparator()
        clear = QAction("Clear Menu", menu)
        clear.setEnabled(bool(self.recents.items))
        clear.triggered.connect(lambda: (self.recents.clear(), self.recents_changed()))
        menu.addAction(clear)

    def fill_window_menu(self, menu: QMenu, marker: QAction) -> None:
        acts = menu.actions()
        start = acts.index(marker) + 1
        for a in acts[start:]:
            menu.removeAction(a)
        for w in self.windows:
            if w.is_start or not w.isVisible():
                continue
            a = QAction(w.state.get("title") or "Untitled", menu)
            a.setCheckable(True)
            a.setChecked(w.isActiveWindow())
            a.triggered.connect(lambda _=False, x=w: (x.showNormal() if x.isMinimized() else None, x.raise_(), x.activateWindow()))
            menu.addAction(a)

    def update_menus(self, w: "DocumentWindow") -> None:
        pass

    # ── panels ──────────────────────────────────────────────────────────────

    def ask_keep(self, win: "DocumentWindow", title: str) -> str:
        if self.selftest is not None:
            return self.selftest.answer_keep(win, title)
        from .window import ask_keep

        return ask_keep(win, title)

    def ask_close_anyway(self, win: "DocumentWindow") -> bool:
        if self.selftest is not None:
            return True
        from .window import ask_close_anyway

        return ask_close_anyway(win)

    def ask_save_path(self, win: "DocumentWindow", suggested: str, kind, folder: str | None) -> str | None:
        if self.selftest is not None:
            return self.selftest.save_path(win, suggested)
        from .window import ask_save_path

        path = ask_save_path(win, suggested, kind, folder or self.last_save_dir)
        if path:
            self.last_save_dir = os.path.dirname(path)
        return path

    def reveal(self, path: str) -> None:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        elif sys.platform == "win32":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            QDesktopServices.openUrl(QUrl.fromLocalFile(os.path.dirname(path)))

    def about(self, parent: "DocumentWindow") -> None:
        QMessageBox.about(parent, f"About {APP_NAME}", f"{APP_NAME} {__version__}\n\nDocs, Sheets and Slides, on this computer.")

    # ── export and print ────────────────────────────────────────────────────

    def _window_for_page(self, page) -> "DocumentWindow | None":
        for w in self.windows:
            if w.page is page:
                return w
        return None

    def on_download(self, req: QWebEngineDownloadRequest) -> None:
        win = self._window_for_page(req.page()) or next((w for w in self.windows if w.isActiveWindow()), None)
        name = req.downloadFileName() or req.suggestedFileName() or "Export"
        if self.selftest is not None:
            target = self.selftest.export_path(name)
        else:
            ext = os.path.splitext(name)[1].lstrip(".")
            filt = f"{ext.upper()} (*.{ext})" if ext else ""
            target, _ = QFileDialog.getSaveFileName(win, "Export", os.path.join(self.last_export_dir, name), filt)
        if not target:
            req.cancel()
            return
        self.last_export_dir = os.path.dirname(target)
        req.setDownloadDirectory(os.path.dirname(target))
        req.setDownloadFileName(os.path.basename(target))
        req.stateChanged.connect(lambda state, r=req, t=target: self._download_state(r, t, state))
        req.accept()

    def _download_state(self, req: QWebEngineDownloadRequest, target: str, state) -> None:
        S = QWebEngineDownloadRequest.DownloadState
        if state == S.DownloadCompleted and self.selftest is not None:
            self.selftest.exported(target)
        elif state == S.DownloadInterrupted:
            QMessageBox.warning(None, APP_NAME, "The file could not be written.")

    def print_window(self, win: "DocumentWindow") -> None:
        if self.selftest is not None:
            self.selftest.printed(win)
            return
        from PySide6.QtPrintSupport import QPrintDialog, QPrinter

        printer = QPrinter(QPrinter.PrinterMode.HighResolution)
        dialog = QPrintDialog(printer, win)
        if dialog.exec() != QPrintDialog.DialogCode.Accepted:
            return
        self.printers.append(printer)

        def done(_ok: bool) -> None:
            if printer in self.printers:
                self.printers.remove(printer)

        win.view.printFinished.connect(done)
        win.view.print(printer)

    # ── logs ────────────────────────────────────────────────────────────────

    def console(self, win: "DocumentWindow", level, message: str, line: int, source: str) -> None:
        if self.selftest is not None:
            self.selftest.console(win, level, message, line, source)
        elif os.environ.get("OFFICE_DEBUG"):
            print(f"[{win.kind or 'start'}] {source}:{line} {message}", file=sys.stderr)

    def log(self, win: "DocumentWindow", level: str, message: str) -> None:
        if self.selftest is not None:
            self.selftest.log(win, level, message)
        elif level != "info" or os.environ.get("OFFICE_DEBUG"):
            print(f"[{win.kind or 'start'}] {level}: {message}", file=sys.stderr)

    def _attach_devtools(self, w: "DocumentWindow") -> None:
        from PySide6.QtWebEngineWidgets import QWebEngineView

        tools = QWebEngineView()
        tools.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        w.page.setDevToolsPage(tools.page())
        tools.resize(900, 700)
        tools.setWindowTitle(f"DevTools: {w.kind or 'start'}")
        tools.show()


def default_data_dir() -> str:
    path = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation)
    return path or os.path.join(os.path.expanduser("~"), ".office")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="officeapps")
    parser.add_argument("--web-dir", default=None)
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--devtools", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--report", default=None)
    parser.add_argument("--fixtures", default=None, help="the repo's tests/corpus, for the self-test's import step")
    parser.add_argument("files", nargs="*")
    args, qt_args = parser.parse_known_args(argv[1:])

    register_scheme()
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app = Application([argv[0], *qt_args])
    app.setApplicationName(APP_NAME)
    app.setApplicationDisplayName(APP_NAME)
    app.setOrganizationName(APP_NAME)
    app.setOrganizationDomain(BUNDLE_ID.rsplit(".", 1)[0])
    app.setApplicationVersion(__version__)
    if sys.platform == "darwin":
        app.setQuitOnLastWindowClosed(False)
    web_dir = os.path.abspath(args.web_dir) if args.web_dir else bundled_web_dir()
    if not os.path.isfile(os.path.join(web_dir, "index.html")):
        print(f"No web app in {web_dir}: run `npm run build` first.", file=sys.stderr)
        return 2
    icon = os.path.join(web_dir, "favicon.svg")
    if os.path.isfile(icon) and sys.platform != "darwin":
        app.setWindowIcon(QIcon(icon))

    selftest = None
    if args.self_test:
        from .selftest import SelfTest

        data_dir = args.data_dir or os.path.join(os.getcwd(), "selftest-data")
        selftest = SelfTest(app, data_dir, args.report, args.fixtures)
    else:
        data_dir = args.data_dir or default_data_dir()

    # The web profile's storage wants an absolute path: a relative one breaks the page's saves.
    data_dir = os.path.abspath(data_dir)
    manager = Manager(app, web_dir, data_dir, devtools=args.devtools, selftest=selftest)
    app.manager = manager
    if selftest is not None:
        selftest.attach(manager)
        QTimer.singleShot(0, selftest.run)
        return app.exec()

    def first_windows() -> None:
        for p in [*args.files, *app.pending_files]:
            manager.open_path(p)
        app.pending_files.clear()
        if not manager.windows:
            manager.show_start()

    # Finder's files arrive as events once the loop runs; give them a moment before showing Start.
    QTimer.singleShot(250, first_windows)
    if sys.platform == "darwin":
        app.applicationStateChanged.connect(
            lambda state: manager.show_start()
            if state == Qt.ApplicationState.ApplicationActive and not manager.visible_windows() and not manager.quitting
            else None
        )
    return app.exec()
