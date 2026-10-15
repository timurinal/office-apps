"""The kinds of document, as the web app's `web/src/desktop/kinds.ts` has them (`kinds.json`)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

_HERE = os.path.dirname(os.path.abspath(__file__))


@dataclass(frozen=True)
class Kind:
    id: str
    label: str
    noun: str
    extension: str
    mime: str
    imports: tuple[str, ...]
    exports: tuple[tuple[str, str], ...]
    enabled: bool


def _load() -> dict[str, Kind]:
    with open(os.path.join(_HERE, "kinds.json"), encoding="utf-8") as f:
        raw = json.load(f)
    return {
        k: Kind(
            id=k,
            label=v["label"],
            noun=v["noun"],
            extension=v["extension"],
            mime=v["mime"],
            imports=tuple(v["imports"]),
            exports=tuple((e["command"], e["label"]) for e in v["exports"]),
            enabled=bool(v["enabled"]),
        )
        for k, v in raw.items()
    }


KINDS = _load()
ENABLED = [k for k in KINDS.values() if k.enabled]


def extension_of(path: str) -> str:
    name = os.path.basename(path)
    dot = name.rfind(".")
    return name[dot + 1 :].lower() if dot > 0 else ""


def classify(path: str) -> tuple[Kind, bool] | None:
    """(kind, native) for a file this app opens, by its extension; None for anything else."""
    ext = extension_of(path)
    for k in ENABLED:
        if ext == k.extension:
            return k, True
        if ext in k.imports:
            return k, False
    return None


def open_filter() -> str:
    """The Open panel's filters: everything this opens first, then each kind's own."""
    every = []
    rows = []
    for k in ENABLED:
        exts = [k.extension, *k.imports]
        every += exts
        rows.append(f"{k.label} ({' '.join('*.' + e for e in exts)})")
    return ";;".join([f"Documents ({' '.join('*.' + e for e in every)})", *rows])
