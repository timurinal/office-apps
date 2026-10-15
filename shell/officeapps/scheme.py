"""
`app://local/`: the web app, served from the folder it was built into.

A registered, secure scheme rather than `file://`, because the app needs a real origin: ES
module workers (the converters), `history.pushState`, `localStorage`, the async clipboard and
`crypto.subtle` all refuse an opaque one. Paths without an extension are the app's routes and get
`index.html`; `/api/` is the server the editors were written for, and there is none.
"""

from __future__ import annotations

import mimetypes
import os

from PySide6.QtCore import QBuffer, QByteArray, QIODevice
from PySide6.QtWebEngineCore import QWebEngineUrlRequestJob, QWebEngineUrlScheme, QWebEngineUrlSchemeHandler

SCHEME = b"app"
HOST = "local"
ORIGIN = "app://local"

MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
    ".map": "application/json",
}


def register_scheme() -> None:
    """Before the QApplication exists, or Chromium never hears of it."""
    s = QWebEngineUrlScheme(SCHEME)
    s.setSyntax(QWebEngineUrlScheme.Syntax.Host)
    s.setFlags(
        QWebEngineUrlScheme.Flag.SecureScheme
        | QWebEngineUrlScheme.Flag.CorsEnabled
        | QWebEngineUrlScheme.Flag.FetchApiAllowed
    )
    QWebEngineUrlScheme.registerScheme(s)


def resolve(root: str, url_path: str) -> str | None:
    """The file under `root` a request for `url_path` is answered with, or None for a 404."""
    rel = url_path.lstrip("/")
    if rel.startswith("api/") or rel == "api":
        return None
    root = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root, rel))
    if target != root and not target.startswith(root + os.sep):
        return None
    if os.path.isfile(target):
        return target
    # A route of the app (`/docs`, `/sheets`): the page itself. Anything that looks like a file is a 404.
    last = rel.rsplit("/", 1)[-1]
    if "." not in last and not rel.startswith(("assets/", "fonts/")):
        index = os.path.join(root, "index.html")
        return index if os.path.isfile(index) else None
    return None


def mime_of(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


class SchemeHandler(QWebEngineUrlSchemeHandler):
    def __init__(self, root: str, parent=None):
        super().__init__(parent)
        self.root = root

    def requestStarted(self, job: QWebEngineUrlRequestJob) -> None:  # noqa: N802 (Qt's name)
        url = job.requestUrl()
        if url.host() != HOST:
            job.fail(QWebEngineUrlRequestJob.Error.UrlInvalid)
            return
        if bytes(job.requestMethod().data()) not in (b"GET", b"HEAD"):
            job.fail(QWebEngineUrlRequestJob.Error.RequestDenied)
            return
        path = resolve(self.root, url.path())
        if path is None:
            job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)
            return
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            job.fail(QWebEngineUrlRequestJob.Error.RequestFailed)
            return
        # Parented to the job, so it lives exactly as long as the reply needs it.
        buf = QBuffer(job)
        buf.setData(QByteArray(data))
        buf.open(QIODevice.OpenModeFlag.ReadOnly)
        job.reply(mime_of(path).encode("ascii"), buf)
