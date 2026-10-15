"""
The page's way to the window it is in: one `host` object per window, over QWebChannel.

    call(requestId, method, argsJson)   from the page; requestId '' wants no answer
    reply(requestId, json)              {ok: true, value} | {ok: false, error: {code, message}}
    command(name, json)                 to the page: the menu bar, the close button, focus lost

Methods are the window's `js_<name>`, and only those. A call is answered on the next turn of the
event loop, never inside the channel's own delivery, so a method may show a dialog.
The page's side is `web/src/desktop/qtHost.ts`.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from PySide6.QtCore import QObject, QTimer, Signal, Slot

from .files import HostError


class Bridge(QObject):
    reply = Signal(str, str)
    command = Signal(str, str)

    def __init__(self, target: Any, parent: QObject | None = None):
        super().__init__(parent)
        self.target = target

    @Slot(str, str, str)
    def call(self, request_id: str, method: str, args_json: str) -> None:
        QTimer.singleShot(0, lambda: self._dispatch(request_id, method, args_json))

    def send(self, name: str, args: dict | None = None) -> None:
        self.command.emit(name, json.dumps(args or {}))

    def _dispatch(self, request_id: str, method: str, args_json: str) -> None:
        handler = getattr(self.target, f"js_{method}", None) if method.isidentifier() else None
        try:
            if handler is None:
                raise HostError("bad_request", f"No such call: {method}")
            args = json.loads(args_json or "{}")
            if not isinstance(args, dict):
                raise HostError("bad_request", "Arguments must be an object.")
            value = handler(**args)
            if request_id:
                self.reply.emit(request_id, json.dumps({"ok": True, "value": value}))
        except HostError as e:
            if request_id:
                self.reply.emit(request_id, json.dumps({"ok": False, "error": {"code": e.code, "message": e.message}}))
        except OSError as e:
            if request_id:
                msg = "There is not enough space on the disk." if getattr(e, "errno", None) == 28 else "The file could not be written."
                if getattr(e, "errno", None) in (13, 1):
                    msg = "This app is not allowed to write there."
                self.reply.emit(request_id, json.dumps({"ok": False, "error": {"code": "io", "message": msg}}))
        except Exception:  # noqa: BLE001 - every failure has to reach the page, or its promise never settles
            traceback.print_exc(file=sys.stderr)
            if request_id:
                self.reply.emit(request_id, json.dumps({"ok": False, "error": {"code": "io", "message": "Something went wrong."}}))
