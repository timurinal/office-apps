"""
Files on disk: writing a document so that a crash never leaves half of one, the backups kept
beside the app's data, and the recent list.

Nothing here touches Qt, so it is tested on its own (`shell/tests/test_files.py`).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import asdict, dataclass

BACKUP_EVERY_S = 10 * 60
BACKUPS_KEPT = 10
RECENTS_KEPT = 20


class HostError(Exception):
    """A refusal the page shows: `code` is what it switches on, the message is the sentence."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def mtime_ms(path: str) -> int:
    return int(os.stat(path).st_mtime_ns // 1_000_000)


def write_atomic(path: str, data: bytes) -> int:
    """Write `data` to `path` by way of a temporary file in the same folder. Returns the new mtime (ms)."""
    folder = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".~", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if os.path.exists(path):
            # Keep the file's permissions; a fresh temp file is 0600.
            os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        else:
            os.chmod(tmp, 0o644 & ~_umask())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    try:
        dfd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass
    return mtime_ms(path)


def _umask() -> int:
    current = os.umask(0)
    os.umask(current)
    return current


_UNSAFE = re.compile(r'[\x00-\x1f/\\:*?"<>|]')


def safe_name(title: str, extension: str) -> str:
    """A file name from a title: no folders, nothing a file system refuses, never empty."""
    base = _UNSAFE.sub(" ", title)
    base = re.sub(r"\s+", " ", base).strip().lstrip(".").strip()[:120].strip()
    return f"{base or 'Untitled'}.{extension}"


class Backups:
    """Copies of a file as it was before it was overwritten: at most one per ten minutes, ten kept."""

    def __init__(self, root: str):
        self.root = root
        self._last: dict[str, float] = {}

    def folder_for(self, path: str) -> str:
        key = hashlib.sha1(os.path.abspath(path).encode("utf-8")).hexdigest()[:12]
        return os.path.join(self.root, key)

    def before_write(self, path: str, now: float | None = None) -> str | None:
        """Copy `path` aside if it is due. Returns the backup's path, or None."""
        if not os.path.exists(path):
            return None
        now = time.time() if now is None else now
        last = self._last.get(path)
        if last is not None and now - last < BACKUP_EVERY_S:
            return None
        folder = self.folder_for(path)
        os.makedirs(folder, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now))
        ext = os.path.splitext(path)[1]
        target = os.path.join(folder, f"{stamp}{ext}")
        with open(path, "rb") as src:
            data = src.read()
        with open(target, "wb") as dst:
            dst.write(data)
        with open(os.path.join(folder, "source.txt"), "w", encoding="utf-8") as f:
            f.write(os.path.abspath(path) + "\n")
        self._last[path] = now
        kept = sorted(n for n in os.listdir(folder) if n != "source.txt")
        for old in kept[:-BACKUPS_KEPT]:
            try:
                os.unlink(os.path.join(folder, old))
            except OSError:
                pass
        return target


@dataclass
class Recent:
    path: str
    name: str
    kind: str
    openedAt: int


class Recents:
    """The recent list: newest first, twenty at most, kept as JSON in the app's data folder."""

    def __init__(self, file: str):
        self.file = file
        self.items: list[Recent] = []
        self._load()

    def _load(self) -> None:
        try:
            with open(self.file, encoding="utf-8") as f:
                raw = json.load(f)
            self.items = [Recent(**r) for r in raw if isinstance(r, dict) and {"path", "name", "kind", "openedAt"} <= r.keys()]
        except (OSError, ValueError, TypeError):
            self.items = []

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.file), exist_ok=True)
        write_atomic(self.file, json.dumps([asdict(r) for r in self.items], indent=1).encode("utf-8"))

    def add(self, path: str, kind: str, now_ms: int | None = None) -> None:
        path = os.path.abspath(path)
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        self.items = [Recent(path, os.path.basename(path), kind, now_ms)] + [r for r in self.items if r.path != path]
        del self.items[RECENTS_KEPT:]
        self._save()

    def replace(self, old: str, new: str) -> None:
        old, new = os.path.abspath(old), os.path.abspath(new)
        for r in self.items:
            if r.path == old:
                r.path, r.name = new, os.path.basename(new)
        self._save()

    def remove(self, path: str) -> None:
        path = os.path.abspath(path)
        self.items = [r for r in self.items if r.path != path]
        self._save()

    def clear(self) -> None:
        self.items = []
        self._save()

    def __contains__(self, path: str) -> bool:
        path = os.path.abspath(path)
        return any(r.path == path for r in self.items)

    def listing(self) -> list[dict]:
        return [{**asdict(r), "exists": os.path.isfile(r.path)} for r in self.items]
