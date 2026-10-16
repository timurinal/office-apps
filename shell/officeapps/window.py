"""
A window: the Start page, one document in its editor, or the audience's half of a presenter's
view of a presentation (opened by that presentation's window, and fed by it).

The page talks to the window through `Bridge` (`js_*` below). The window owns what only it can
do: the file on disk, the save panel, its title and edited dot, and closing, which waits for the
page to finish writing (a file) or asks first (a new document with something in it).
"""

from __future__ import annotations

import base64
import os
import sys
import uuid
from typing import TYPE_CHECKING, Any

from PySide6.QtCore import QByteArray, QEvent, QPoint, QSettings, Qt, QTimer, QUrl, QUrlQuery
from PySide6.QtGui import QAction, QCloseEvent, QDesktopServices
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEnginePermission, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QFileDialog, QMainWindow, QMessageBox

from . import APP_NAME, __version__
from .bridge import Bridge
from .files import HostError, mtime_ms, safe_name, write_atomic
from .kinds import KINDS
from .scheme import ORIGIN

if TYPE_CHECKING:
    from .app import Manager

EXTERNAL = ("http", "https", "mailto")
CLOSE_WAIT_MS = 10_000

# What the right-click menu keeps: editing and spelling. Nothing that navigates, saves the page or inspects it.
_DROPPED_ACTIONS = [
    "Back",
    "Forward",
    "Reload",
    "ReloadAndBypassCache",
    "Stop",
    "ViewSource",
    "SavePage",
    "InspectElement",
    "OpenLinkInThisWindow",
    "OpenLinkInNewWindow",
    "OpenLinkInNewTab",
    "OpenLinkInNewBackgroundTab",
    "DownloadLinkToDisk",
    "DownloadImageToDisk",
    "DownloadMediaToDisk",
    "CopyImageUrlToClipboard",
    "CopyMediaUrlToClipboard",
    "ToggleMediaControls",
    "ToggleMediaLoop",
    "ToggleMediaPlayPause",
    "ToggleMediaMute",
    "OpenInChrome",
]


class Page(QWebEnginePage):
    def __init__(self, profile, window: "DocumentWindow"):
        super().__init__(profile, window)
        self.win = window
        self.started = False
        self.permissionRequested.connect(self._on_permission)
        self.newWindowRequested.connect(self._on_new_window)
        self.fullScreenRequested.connect(self._on_full_screen)
        self.windowCloseRequested.connect(self._on_close_requested)

    def acceptNavigationRequest(self, url: QUrl, nav_type, is_main_frame: bool) -> bool:  # noqa: N802
        scheme = url.scheme()
        if not is_main_frame:
            return scheme in ("app", "about", "data", "blob")
        if scheme == "app":
            if not self.started:
                self.started = True
                return True
            # The editors never load another page in a window; the header's link to Start is the one that would.
            if url.path() in ("", "/"):
                QTimer.singleShot(0, self.win.manager.show_start)
            return False
        if scheme in EXTERNAL:
            QDesktopServices.openUrl(url)
        return False

    def chooseFiles(self, mode, old_files: list[str], accepted: list[str]) -> list[str]:  # noqa: N802
        if self.win.manager.selftest is not None:
            return self.win.manager.selftest.choose_files()
        return super().chooseFiles(mode, old_files, accepted)

    def javaScriptConsoleMessage(self, level, message: str, line: int, source: str) -> None:  # noqa: N802
        self.win.manager.console(self.win, level, message, line, source)

    def _on_permission(self, permission: QWebEnginePermission) -> None:
        if (
            permission.permissionType() == QWebEnginePermission.PermissionType.ClipboardReadWrite
            and permission.origin().toString().rstrip("/") == ORIGIN
        ):
            permission.grant()
        else:
            permission.deny()

    def _on_new_window(self, request) -> None:
        url = request.requestedUrl()
        if is_audience_url(url) and self.win.kind == "slides" and not self.win.audience:
            self.win.manager.open_audience(request, self.win)
        elif url.scheme() in EXTERNAL:
            QDesktopServices.openUrl(url)

    def _on_full_screen(self, request) -> None:
        # A slide show asks for the screen; leaving it (Escape, or the page's own button) asks back.
        request.accept()
        self.win.set_page_full_screen(request.toggleOn())

    def _on_close_requested(self) -> None:
        # Only a window a script opened may close itself: the audience's, when the show ends.
        if self.win.audience:
            self.win.force_close = True
            self.win.close()


def is_audience_url(url: QUrl) -> bool:
    """The audience's window of a presenter's view: `app://local/slides?...&present=audience`."""
    return (
        url.scheme() == "app"
        and url.host() == "local"
        and url.path() == "/slides"
        and QUrlQuery(url).queryItemValue("present") == "audience"
    )


class View(QWebEngineView):
    def contextMenuEvent(self, event) -> None:  # noqa: N802
        menu = self.createStandardContextMenu()
        page = self.page()
        dropped = set()
        for name in _DROPPED_ACTIONS:
            action = getattr(QWebEnginePage.WebAction, name, None)
            if action is not None:
                dropped.add(page.action(action))
        for a in list(menu.actions()):
            if a in dropped:
                menu.removeAction(a)
        # No separator first, last or twice.
        prev_sep = True
        for a in list(menu.actions()):
            if a.isSeparator() and prev_sep:
                menu.removeAction(a)
                continue
            prev_sep = a.isSeparator()
        acts = menu.actions()
        if acts and acts[-1].isSeparator():
            menu.removeAction(acts[-1])
        if not menu.actions():
            menu.deleteLater()
            return
        menu.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        menu.popup(event.globalPos())


class DocumentWindow(QMainWindow):
    def __init__(self, manager: "Manager", open_request: dict | None, audience: bool = False):
        super().__init__()
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        self.manager = manager
        self.window_id = uuid.uuid4().hex[:12]
        self.open_request = open_request
        # An audience window has no document of its own: the page is loaded by the window that opened it.
        self.audience = audience
        self.kind: str | None = "slides" if audience else (open_request["kind"] if open_request else None)
        self.path: str | None = os.path.abspath(open_request["path"]) if open_request and open_request.get("source") == "file" else None
        self.import_dir: str | None = os.path.dirname(open_request["path"]) if open_request and open_request.get("source") == "import" else None
        self.known_mtime: int | None = None
        self.state: dict[str, Any] = {"title": APP_NAME, "dirty": False, "hasPath": self.path is not None, "saving": False}
        self.js_ready = False
        self.force_close = False
        self.close_timer: QTimer | None = None
        self.menu_actions: dict[str, QAction] = {}
        self.page_full_screen = False
        self.was_maximised = False

        self.view = View(self)
        self.page = Page(manager.profile, self)
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)

        self.bridge = Bridge(self, self)
        self.channel = QWebChannel(self.page)
        self.channel.registerObject("host", self.bridge)
        self.page.setWebChannel(self.channel)
        script = QWebEngineScript()
        script.setName("desktop-host")
        script.setSourceCode(manager.channel_script)
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        self.page.scripts().insert(script)
        self.page.printRequestedByFrame.connect(lambda _frame: self.print_document())

        from .menus import build_menus

        build_menus(self)
        self.setMinimumSize(900, 600)
        self._restore_geometry()
        self.setWindowTitle(APP_NAME if self.kind is None else "")
        if self.path:
            self.setWindowFilePath(self.path)

        if audience:
            self.page.titleChanged.connect(self._audience_title)
            return
        route = f"/{self.kind}?w={self.window_id}" if self.kind else "/"
        self.page.load(QUrl(ORIGIN + route))

    # ── the window ──────────────────────────────────────────────────────────

    @property
    def is_start(self) -> bool:
        return self.kind is None

    def send(self, name: str, args: dict | None = None) -> None:
        self.bridge.send(name, args)

    def _settings_key(self) -> str:
        return "geometry/audience" if self.audience else f"geometry/{self.kind or 'start'}"

    def _restore_geometry(self) -> None:
        geo = QSettings().value(self._settings_key())
        if isinstance(geo, QByteArray) and self.restoreGeometry(geo):
            # A second window of a kind lands a little down and right of the first.
            offset = 28 * sum(1 for w in self.manager.windows if w is not self and w.kind == self.kind and w.isVisible())
            if offset:
                self.move(self.pos() + QPoint(offset, offset))
            return
        self.resize(1280 if self.kind else 1100, 820 if self.kind else 760)

    def _audience_title(self, title: str) -> None:
        self.state["title"] = title or APP_NAME
        self.setWindowTitle(self.state["title"])

    def set_page_full_screen(self, on: bool) -> None:
        if on == self.page_full_screen:
            return
        self.page_full_screen = on
        if on:
            self.was_maximised = self.isMaximized()
            if sys.platform != "darwin":
                self.menuBar().hide()
            self.showFullScreen()
        else:
            self.menuBar().show()
            if self.was_maximised:
                self.showMaximized()
            else:
                self.showNormal()

    def changeEvent(self, event) -> None:  # noqa: N802
        if event.type() == QEvent.Type.WindowStateChange and self.page_full_screen and not self.isFullScreen():
            # Out of full screen another way (the green button): the show leaves it too.
            self.page_full_screen = False
            self.menuBar().show()
            self.page.triggerAction(QWebEnginePage.WebAction.ExitFullScreen)
        if event.type() == QEvent.Type.ActivationChange:
            if self.isActiveWindow():
                self.manager.window_activated(self)
            elif self.js_ready and self.state.get("dirty") and self.state.get("hasPath"):
                # Going to the back: write what is pending now, not 1.5 s later.
                self.send("flush")
        super().changeEvent(event)

    def closeEvent(self, event: QCloseEvent) -> None:  # noqa: N802
        if self.force_close or not self.js_ready or not self.state.get("dirty"):
            self._closing()
            event.accept()
            return
        event.ignore()
        self.raise_()
        self.activateWindow()
        if self.state.get("hasPath"):
            self._wait_for_close()
            self.send("close", {"mode": "flush"})
            return
        answer = self.manager.ask_keep(self, self.state.get("title") or "Untitled")
        if answer == "save":
            self._wait_for_close()
            self.send("close", {"mode": "saveAs"})
        elif answer == "delete":
            self.force_close = True
            QTimer.singleShot(0, self.close)
        else:
            self.manager.quit_cancelled()

    def _wait_for_close(self) -> None:
        if self.close_timer:
            self.close_timer.stop()
        t = QTimer(self)
        t.setSingleShot(True)
        t.timeout.connect(self._close_stalled)
        t.start(CLOSE_WAIT_MS)
        self.close_timer = t

    def _close_stalled(self) -> None:
        if self.force_close:
            return
        if self.manager.ask_close_anyway(self):
            self.force_close = True
            self.close()
        else:
            self.manager.quit_cancelled()

    def _closing(self) -> None:
        if self.close_timer:
            self.close_timer.stop()
        QSettings().setValue(self._settings_key(), self.saveGeometry())
        self.manager.window_closed(self)

    def apply_state(self) -> None:
        title = self.state.get("title") or APP_NAME
        self.setWindowTitle(f"{title}[*]")
        self.setWindowModified(bool(self.state.get("dirty")))
        self.setWindowFilePath(self.path or "")
        self.manager.update_menus(self)

    def print_document(self) -> None:
        self.manager.print_window(self)

    # ── what the page asks ──────────────────────────────────────────────────

    def js_hello(self) -> dict:
        self.js_ready = True
        req = dict(self.open_request) if self.open_request else None
        return {
            "windowId": self.window_id,
            "platform": {"darwin": "mac", "win32": "windows"}.get(sys.platform, "linux"),
            "appName": APP_NAME,
            "version": __version__,
            "selfTest": self.manager.selftest is not None,
            "open": req,
        }

    def js_readOpened(self) -> str:  # noqa: N802
        req = self.open_request
        if not req or req.get("source") not in ("file", "import"):
            raise HostError("bad_request", "Nothing to read.")
        path = req["path"]
        try:
            with open(path, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            raise HostError("not_found", "That file is not there any more.") from None
        if req["source"] == "file":
            self.known_mtime = mtime_ms(path)
            self.manager.note_recent(path, self.kind or "docs")
        return base64.b64encode(data).decode("ascii")

    def js_setState(self, title: str = "", dirty: bool = False, hasPath: bool = False, saving: bool = False) -> None:  # noqa: N802,N803
        self.state = {"title": title, "dirty": bool(dirty), "hasPath": bool(hasPath), "saving": bool(saving)}
        self.apply_state()

    def js_save(self, data: str, force: bool = False) -> dict:
        if not self.path:
            raise HostError("bad_request", "This document has no file yet.")
        if not force and self.known_mtime is not None and os.path.exists(self.path) and mtime_ms(self.path) != self.known_mtime:
            raise HostError("stale", "This file was changed by another app.")
        return self._write(self.path, base64.b64decode(data))

    def js_saveAs(self, data: str, suggestedName: str) -> dict | None:  # noqa: N802,N803
        kind = KINDS[self.kind or "docs"]
        path = self.manager.ask_save_path(self, suggestedName, kind, self.import_dir)
        if not path:
            return None
        if not path.lower().endswith("." + kind.extension):
            path += "." + kind.extension
        path = os.path.abspath(path)
        other = self.manager.window_for_path(path)
        if other is not None and other is not self:
            raise HostError("exists", "That file is open in another window.")
        result = self._write(path, base64.b64decode(data))
        self.path = path
        self.import_dir = None
        self.state["hasPath"] = True
        self.apply_state()
        return result

    def js_rename(self, name: str) -> dict:
        if not self.path:
            raise HostError("bad_request", "This document has no file yet.")
        kind = KINDS[self.kind or "docs"]
        target = os.path.join(os.path.dirname(self.path), safe_name(name, kind.extension))
        if os.path.abspath(target) == self.path:
            return {"path": self.path, "name": os.path.basename(self.path), "mtime": mtime_ms(self.path)}
        if os.path.exists(target):
            raise HostError("exists", "There is already a file with that name.")
        os.rename(self.path, target)
        old, self.path = self.path, os.path.abspath(target)
        self.known_mtime = mtime_ms(self.path)
        self.manager.recents.replace(old, self.path)
        self.manager.recents_changed()
        self.apply_state()
        return {"path": self.path, "name": os.path.basename(self.path), "mtime": self.known_mtime}

    def _write(self, path: str, data: bytes) -> dict:
        self.manager.backups.before_write(path)
        self.known_mtime = write_atomic(path, data)
        self.manager.note_recent(path, self.kind or "docs")
        return {"path": path, "name": os.path.basename(path), "mtime": self.known_mtime}

    def js_newDocument(self, kind: str, templateId: str | None = None) -> None:  # noqa: N802,N803
        self.manager.new_document(kind, templateId, origin=self)

    def js_open(self) -> None:
        self.manager.open_dialog(self)

    def js_openRecent(self, path: str) -> None:  # noqa: N802
        if path in self.manager.recents:
            self.manager.open_path(path, origin=self)

    def js_forgetRecent(self, path: str) -> None:  # noqa: N802
        self.manager.recents.remove(path)
        self.manager.recents_changed()

    def js_reveal(self, path: str) -> None:
        if path == self.path or path in self.manager.recents:
            self.manager.reveal(path)

    def js_recents(self) -> list:
        return self.manager.recents.listing()

    def js_showStart(self) -> None:  # noqa: N802
        self.manager.show_start()

    def js_openExternal(self, url: str) -> None:  # noqa: N802
        q = QUrl(url)
        if q.scheme() in EXTERNAL:
            QDesktopServices.openUrl(q)

    def js_close(self, force: bool = False) -> None:
        if force:
            self.force_close = True
        self.close()

    def js_log(self, level: str = "info", message: str = "") -> None:
        self.manager.log(self, level, message)


def ask_keep(parent: QMainWindow, title: str) -> str:
    """'save', 'delete' or 'cancel'. A sheet on macOS."""
    box = QMessageBox(parent)
    box.setIcon(QMessageBox.Icon.Warning)
    box.setWindowModality(Qt.WindowModality.WindowModal)
    box.setText(f"Do you want to keep this new document “{title}”?")
    save = box.addButton("Save…", QMessageBox.ButtonRole.AcceptRole)
    delete = box.addButton("Delete", QMessageBox.ButtonRole.DestructiveRole)
    box.addButton(QMessageBox.StandardButton.Cancel)
    box.setDefaultButton(save)
    box.exec()
    clicked = box.clickedButton()
    return "save" if clicked is save else "delete" if clicked is delete else "cancel"


def ask_close_anyway(parent: QMainWindow) -> bool:
    box = QMessageBox(parent)
    box.setIcon(QMessageBox.Icon.Warning)
    box.setWindowModality(Qt.WindowModality.WindowModal)
    box.setText("Your latest changes could not be saved.")
    close = box.addButton("Close anyway", QMessageBox.ButtonRole.DestructiveRole)
    box.addButton(QMessageBox.StandardButton.Cancel)
    box.exec()
    return box.clickedButton() is close


def ask_save_path(parent: QMainWindow, suggested: str, kind, folder: str) -> str | None:
    path, _ = QFileDialog.getSaveFileName(
        parent,
        "Save",
        os.path.join(folder, suggested),
        f"{kind.label} (*.{kind.extension})",
    )
    return path or None
