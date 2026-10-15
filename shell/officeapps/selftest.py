"""
`--self-test`: the app, driven through its real windows, bridge, files and menus, on this machine.

It is what CI runs against the built `.app` on macOS, and what a person runs here under Xvfb:

    xvfb-run -a python -m officeapps --self-test --data-dir /tmp/st --report /tmp/st/report.json \
        --web-dir ../dist/web --fixtures ../tests/corpus

Every save panel answers with a path in the data folder, every export lands there, and the
"keep this new document?" question is answered Delete. The page is reached through
`window.__selftest` (`web/src/desktop/selftest.ts`). Exits 0 when every step passed.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
import traceback
import zipfile
from typing import TYPE_CHECKING, Any, Callable

from PySide6.QtCore import QEventLoop, Qt, QTimer
from PySide6.QtTest import QTest

if TYPE_CHECKING:
    from .app import Application, Manager
    from .window import DocumentWindow


class StepFailed(Exception):
    pass


class SelfTest:
    def __init__(self, app: "Application", data_dir: str, report: str | None, fixtures: str | None):
        self.app = app
        self.data_dir = os.path.abspath(data_dir)
        if os.path.isdir(self.data_dir):
            shutil.rmtree(self.data_dir)
        self.out = os.path.join(self.data_dir, "out")
        os.makedirs(self.out, exist_ok=True)
        self.report_path = report
        self.fixtures = fixtures
        self.manager: Manager | None = None
        self.steps: list[dict[str, Any]] = []
        self.messages: list[str] = []
        self.next_save: str | None = None
        self.exports: list[str] = []
        self.keep_asked: list[str] = []
        self.prints = 0

    def attach(self, manager: "Manager") -> None:
        self.manager = manager

    # ── what the manager asks ───────────────────────────────────────────────

    def answer_keep(self, win: "DocumentWindow", title: str) -> str:
        self.keep_asked.append(title)
        return "delete"

    def save_path(self, win: "DocumentWindow", suggested: str) -> str:
        name = self.next_save or suggested
        self.next_save = None
        return os.path.join(self.out, name)

    def export_path(self, name: str) -> str:
        return os.path.join(self.out, "export-" + name)

    def exported(self, path: str) -> None:
        self.exports.append(path)

    def printed(self, win: "DocumentWindow") -> None:
        self.prints += 1

    def console(self, win, level, message: str, line: int, source: str) -> None:
        name = getattr(level, "name", str(level))
        self.messages.append(f"[{win.kind or 'start'}] {name} {source}:{line} {message}")

    def log(self, win, level: str, message: str) -> None:
        self.messages.append(f"[{win.kind or 'start'}] host {level}: {message}")

    # ── waiting ─────────────────────────────────────────────────────────────

    def pump(self, ms: int) -> None:
        loop = QEventLoop()
        QTimer.singleShot(ms, loop.quit)
        loop.exec()

    def js(self, win: "DocumentWindow", code: str, timeout_ms: int = 10_000) -> Any:
        loop = QEventLoop()
        out: dict[str, Any] = {}

        def done(value: Any) -> None:
            out["v"] = value
            loop.quit()

        win.page.runJavaScript(code, 0, done)
        QTimer.singleShot(timeout_ms, loop.quit)
        loop.exec()
        if "v" not in out:
            raise StepFailed(f"no answer from the page to {code[:80]}")
        return out["v"]

    def until(self, what: str, check: Callable[[], Any], timeout_ms: int = 20_000) -> Any:
        end = time.monotonic() + timeout_ms / 1000
        last: Any = None
        while time.monotonic() < end:
            try:
                last = check()
            except StepFailed:
                last = None
            if last:
                return last
            self.pump(100)
        raise StepFailed(f"timed out waiting for {what} (last: {last!r})")

    def st(self, win: "DocumentWindow", call: str) -> Any:
        return self.js(win, f"window.__selftest ? JSON.stringify(window.__selftest.{call}) : null")

    def st_value(self, win: "DocumentWindow", call: str) -> Any:
        raw = self.st(win, call)
        if not isinstance(raw, str):
            return raw
        # A script sent while the page is still loading comes back empty.
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def ready(self, win: "DocumentWindow") -> None:
        self.until(f"{win.kind or 'start'} to be ready", lambda: self.st_value(win, "ready()"), 30_000)

    def session(self, win: "DocumentWindow") -> dict:
        return self.st_value(win, "session()") or {}

    def later(self, win: "DocumentWindow", key: str) -> Any:
        def check():
            r = self.st_value(win, f"result({json.dumps(key)})")
            return r if r and not r.get("pending") else None

        r = self.until(f"result {key}", check)
        if "error" in r:
            raise StepFailed(f"{key}: {r['error']}")
        return r["value"]

    def shot(self, win: "DocumentWindow", name: str) -> None:
        self.pump(800)
        win.grab().save(os.path.join(self.out, f"{name}.png"))

    def closed(self, win: "DocumentWindow") -> None:
        self.until("the window to close", lambda: win not in self.manager.windows, 15_000)

    # ── steps ───────────────────────────────────────────────────────────────

    def step(self, name: str, fn: Callable[[], str | None]) -> None:
        started = time.monotonic()
        try:
            detail = fn() or ""
            self.steps.append({"name": name, "ok": True, "detail": detail, "ms": int((time.monotonic() - started) * 1000)})
            print(f"  ok    {name} {detail}", flush=True)
        except Exception as e:  # noqa: BLE001
            self.steps.append({"name": name, "ok": False, "detail": f"{type(e).__name__}: {e}", "ms": int((time.monotonic() - started) * 1000)})
            print(f"  FAIL  {name}: {e}", flush=True)
            if not isinstance(e, StepFailed):
                traceback.print_exc()

    def run(self) -> None:
        m = self.manager
        assert m is not None
        print("Office self-test", flush=True)
        state: dict[str, Any] = {}

        def start() -> str:
            w = m.show_start()
            self.ready(w)
            self.shot(w, "start")
            state["start"] = w
            return ""

        def docs_round_trip() -> str:
            w = m.new_document("docs", None, origin=state.get("start"))
            self.ready(w)
            if not self.st_value(w, "typeText('Hello from the self-test.')"):
                raise StepFailed("could not type")
            self.until("the document to be dirty", lambda: self.session(w).get("dirty"))
            self.next_save = "Self-test note.oadoc"
            w.menu_actions["save"].trigger()
            s = self.until("the save to finish", lambda: (lambda s: s if s.get("path") and not s.get("dirty") else None)(self.session(w)))
            path = s["path"]
            if not os.path.isfile(path) or not zipfile.is_zipfile(path):
                raise StepFailed(f"no file at {path}")
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
                manifest = json.loads(z.read("manifest.json"))
            if names[0] != "mimetype" or manifest.get("kind") != "docs":
                raise StepFailed(f"unexpected container: {names} {manifest}")
            # An edit after that saves itself.
            before = os.stat(path).st_mtime_ns
            self.st_value(w, "typeText(' And then some.')")
            self.until("the autosave", lambda: os.stat(path).st_mtime_ns != before and not self.session(w).get("dirty"), 15_000)
            self.shot(w, "docs")
            w.close()
            self.closed(w)
            again = m.open_path(path)
            self.ready(again)
            text = self.st_value(again, "docText()") or ""
            if "Hello from the self-test. And then some." not in text:
                raise StepFailed(f"reopened text is {text!r}")
            state["docs_path"] = path
            again.close()
            self.closed(again)
            return os.path.basename(path)

        def template() -> str:
            w = m.new_document("docs", "predefined:meeting-notes")
            self.ready(w)
            text = self.st_value(w, "docText()") or ""
            if len(text) < 20:
                raise StepFailed(f"template text is {text!r}")
            w.close()
            self.closed(w)
            return f"{len(text)} characters"

        def import_docx() -> str:
            if not self.fixtures:
                return "skipped: no --fixtures"
            src = os.path.join(self.fixtures, "docx", "04-images.docx")
            dst = os.path.join(self.out, "Pictures.docx")
            shutil.copyfile(src, dst)
            w = m.open_path(dst)
            self.ready(w)
            images = self.until("the pictures", lambda: self.st_value(w, "images()"), 15_000)
            if not all(i.startswith("data:image/") for i in images):
                raise StepFailed(f"pictures: {images}")
            self.exports.clear()
            w.send("export", {"command": "file.download-docx"})
            self.until("the export", lambda: self.exports, 30_000)
            out = self.exports[0]
            with zipfile.ZipFile(out) as z:
                core = z.read("docProps/core.xml").decode("utf-8")
                if "word/document.xml" not in z.namelist():
                    raise StepFailed("no word/document.xml")
            if "<dc:creator>Office</dc:creator>" not in core:
                raise StepFailed(f"creator: {core[:300]}")
            w.close()
            self.closed(w)
            return f"{len(images)} pictures, exported {os.path.basename(out)}"

        def sheets_round_trip() -> str:
            w = m.new_document("sheets", None)
            self.ready(w)
            for ref, text in [("A1", "2"), ("A2", "3"), ("A3", "=SUM(A1:A2)")]:
                if not self.st_value(w, f"setCell({json.dumps(ref)}, {json.dumps(text)})"):
                    raise StepFailed(f"could not set {ref}")
            self.until("A3 to be 5", lambda: self.st_value(w, "cellText('A3')") == "5")
            self.until("the workbook to be dirty", lambda: self.session(w).get("dirty"))
            self.next_save = "Self-test book.oasheet"
            w.menu_actions["save"].trigger()
            s = self.until("the save", lambda: (lambda s: s if s.get("path") and not s.get("dirty") else None)(self.session(w)))
            self.exports.clear()
            w.send("export", {"command": "file.download-xlsx"})
            w.send("export", {"command": "file.download-csv"})
            self.until("two exports", lambda: len(self.exports) >= 2, 60_000)
            csv = next((p for p in self.exports if p.endswith(".csv")), None)
            xlsx = next((p for p in self.exports if p.endswith(".xlsx")), None)
            if not csv or not xlsx:
                raise StepFailed(f"exports: {self.exports}")
            with open(csv, encoding="utf-8-sig") as f:
                body = f.read()
            if "5" not in body.split():
                raise StepFailed(f"csv: {body!r}")
            with zipfile.ZipFile(xlsx) as z:
                if "<dc:creator>Office</dc:creator>" not in z.read("docProps/core.xml").decode("utf-8"):
                    raise StepFailed("xlsx creator")
            self.shot(w, "sheets")
            w.close()
            self.closed(w)
            again = m.open_path(s["path"])
            self.ready(again)
            self.until("A3 after reopening", lambda: self.st_value(again, "cellText('A3')") == "5")
            state["sheet"] = again
            return os.path.basename(s["path"])

        def keys() -> str:
            w = state["sheet"]
            w.activateWindow()
            w.view.setFocus()
            self.pump(300)
            if not self.st_value(w, "setCell('B1', '1')"):
                raise StepFailed("could not set B1")
            target = w.view.focusProxy() or w.view
            QTest.mouseClick(target, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, target.rect().center())
            self.pump(300)
            QTest.keyClicks(target, "42")
            QTest.keyClick(target, Qt.Key.Key_Return)
            self.pump(500)
            # Somewhere in the grid a cell now reads 42; the click decides which.
            found = self.js(w, "Array.from({length: 40}, (_, r) => Array.from({length: 12}, (_, c) => window.__selftest.cellText(String.fromCharCode(65 + c) + (r + 1)))).flat().includes('42')")
            if not found:
                raise StepFailed("typing into the grid did not land")
            return ""

        def print_pdf() -> str:
            w = state["sheet"]
            target = os.path.join(self.out, "print.pdf")
            loop = QEventLoop()
            w.page.pdfPrintingFinished.connect(lambda *_: loop.quit())
            w.page.printToPdf(target)
            QTimer.singleShot(30_000, loop.quit)
            loop.exec()
            size = os.path.getsize(target) if os.path.exists(target) else 0
            if size < 1000:
                raise StepFailed(f"pdf is {size} bytes")
            return f"{size} bytes"

        def clipboard() -> str:
            w = state["sheet"]
            self.st_value(w, "clipboard('clip', 'office self-test')")
            value = self.later(w, "clip")
            if value != "office self-test":
                raise StepFailed(f"read back {value!r}")
            return ""

        def close_untitled() -> str:
            state["sheet"].close()
            w = m.new_document("docs", None)
            self.ready(w)
            self.st_value(w, "typeText('Throw me away.')")
            self.until("dirty", lambda: self.session(w).get("dirty"))
            w.close()
            self.closed(w)
            if not self.keep_asked:
                raise StepFailed("closing a new, edited document did not ask")
            return f"asked about {self.keep_asked[-1]!r}"

        def no_network() -> str:
            bad = [msg for msg in self.messages if "http://" in msg or "https://" in msg]
            if bad:
                raise StepFailed("; ".join(bad[:3]))
            return ""

        for name, fn in [
            ("start window", start),
            ("docs: type, save, autosave, reopen", docs_round_trip),
            ("docs: template", template),
            ("docs: import docx with pictures, export docx", import_docx),
            ("sheets: formula, save, export xlsx and csv, reopen", sheets_round_trip),
            ("sheets: typing through Qt's keyboard", keys),
            ("print to pdf", print_pdf),
            ("clipboard", clipboard),
            ("closing a new edited document asks", close_untitled),
            ("no requests left the app", no_network),
        ]:
            self.step(name, fn)

        ok = all(s["ok"] for s in self.steps)
        errors = [msg for msg in self.messages if " Error " in msg or "ErrorMessageLevel" in msg or "host error" in msg]
        report = {"ok": ok, "steps": self.steps, "console": self.messages, "errors": errors, "out": self.out}
        if self.report_path:
            with open(self.report_path, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
        print(f"\n{sum(s['ok'] for s in self.steps)} of {len(self.steps)} passed", flush=True)
        if errors:
            print("Console errors:\n  " + "\n  ".join(errors[:20]), flush=True)
        m.quit_ready = True
        self.app.exit(0 if ok else 1)
