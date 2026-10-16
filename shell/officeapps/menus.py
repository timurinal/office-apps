"""
The menu bar, one per window (macOS shows the active window's at the top of the screen).

What the page does itself goes to the page as a command: Save, Export, Print, Undo, Redo, Find.
Cut, Copy, Paste and Select All are the web view's own actions, which raise the same clipboard
events a key press does, so the Sheets grid's copy and paste work from the menu as from the keys.

A key that the page should have stays out of the menu: QtWebEngine hands a shortcut to the page
only when no menu item claims it (except an editing key in an editable field, which the page
always gets first). So ⌘B, ⌘K and the rest are the page's; ⌘S, ⌘O and ⌘W are the window's.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWidgets import QMenu

from . import APP_NAME
from .kinds import ENABLED, KINDS

if TYPE_CHECKING:
    from .window import DocumentWindow


def _act(win: "DocumentWindow", menu: QMenu, key: str, text: str, run, shortcut=None, role=None) -> QAction:
    a = QAction(text, win)
    if shortcut is not None:
        a.setShortcut(shortcut if isinstance(shortcut, QKeySequence) else QKeySequence(shortcut))
    if role is not None:
        a.setMenuRole(role)
    a.triggered.connect(run)
    menu.addAction(a)
    win.menu_actions[key] = a
    return a


def build_menus(win: "DocumentWindow") -> None:
    m = win.manager
    bar = win.menuBar()
    # An audience window shows a presentation and holds none.
    doc = not win.is_start and not win.audience
    SK = QKeySequence.StandardKey

    # ── File ────────────────────────────────────────────────────────────────
    f = bar.addMenu("&File")
    for k in ENABLED:
        key = "new-" + k.id
        shortcut = SK.New if k.id == "docs" else (QKeySequence("Ctrl+Alt+N") if k.id == "sheets" else None)
        _act(win, f, key, f"New {k.noun.capitalize()}", lambda _=False, kind=k.id: m.new_document(kind, None, origin=win), shortcut)
    f.addSeparator()
    _act(win, f, "open", "Open…", lambda: m.open_dialog(win), SK.Open)
    recent = f.addMenu("Open Recent")
    recent.aboutToShow.connect(lambda: m.fill_recent_menu(recent, win))
    f.addSeparator()
    _act(win, f, "close", "Close", win.close, SK.Close)
    save = _act(win, f, "save", "Save", lambda: win.send("save"), SK.Save)
    save_as = _act(win, f, "save-as", "Save As…", lambda: win.send("saveAs"), QKeySequence("Ctrl+Shift+S"))
    save.setEnabled(doc)
    save_as.setEnabled(doc)
    f.addSeparator()
    export = f.addMenu("Export")
    if doc:
        for command, label in KINDS[win.kind].exports:
            a = QAction(label, win)
            a.triggered.connect(lambda _=False, c=command: win.send("export", {"command": c}))
            export.addAction(a)
    export.setEnabled(doc and bool(KINDS[win.kind].exports) if doc else False)
    printer = _act(win, f, "print", "Print…", lambda: win.send("print"), SK.Print)
    printer.setEnabled(win.kind == "docs")
    f.addSeparator()
    _act(win, f, "quit", f"Quit {APP_NAME}", m.request_quit, SK.Quit, QAction.MenuRole.QuitRole)

    # ── Edit ────────────────────────────────────────────────────────────────
    e = bar.addMenu("&Edit")
    _act(win, e, "undo", "Undo", lambda: win.send("undo"), SK.Undo).setEnabled(doc)
    _act(win, e, "redo", "Redo", lambda: win.send("redo"), SK.Redo).setEnabled(doc)
    e.addSeparator()
    W = QWebEnginePage.WebAction
    _act(win, e, "cut", "Cut", lambda: win.page.triggerAction(W.Cut), SK.Cut)
    _act(win, e, "copy", "Copy", lambda: win.page.triggerAction(W.Copy), SK.Copy)
    _act(win, e, "paste", "Paste", lambda: win.page.triggerAction(W.Paste), SK.Paste)
    _act(win, e, "select-all", "Select All", lambda: win.page.triggerAction(W.SelectAll), SK.SelectAll)
    e.addSeparator()
    _act(win, e, "find", "Find…", lambda: win.send("find"), SK.Find).setEnabled(doc)

    # ── Window ──────────────────────────────────────────────────────────────
    w = bar.addMenu("&Window")
    _act(win, w, "minimise", "Minimise", win.showMinimized, QKeySequence("Ctrl+M"))
    _act(win, w, "zoom", "Zoom", lambda: win.showNormal() if win.isMaximized() else win.showMaximized())
    w.addSeparator()
    _act(win, w, "start", "Start", m.show_start, QKeySequence("Ctrl+Shift+0"))
    w.addSeparator()
    marker = w.addSeparator()
    marker.setVisible(False)
    w.aboutToShow.connect(lambda: m.fill_window_menu(w, marker))

    # ── Help ────────────────────────────────────────────────────────────────
    h = bar.addMenu("&Help")
    _act(win, h, "about", f"About {APP_NAME}", lambda: m.about(win), role=QAction.MenuRole.AboutRole)
