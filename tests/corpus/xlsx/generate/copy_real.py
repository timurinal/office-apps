#!/usr/bin/env python3
"""
Copy the real-world workbooks of the corpus out of a checkout of IronCalc's tests and record where each came from.

    python -I copy_real.py PATH/TO/ironcalc-0.8.3/tests

IronCalc (https://github.com/ironcalc/IronCalc, MIT OR Apache-2.0, Copyright Nicolás Hatcher and contributors)
publishes its test workbooks in the `ironcalc` crate. The ones below were written by Microsoft Excel and
LibreOffice Calc (the producer is read off each file's own markers and recorded in the manifest), so their cached
values are those programs' answers, which is what the calculation tests compare against.

The files are copied unchanged. `real/manifest.json` has the upstream path, the SHA-256 and the producer of each,
and `tests/corpus/xlsx/corpus.test.ts` checks the hashes, so a file edited here by mistake is a failing test.
Nothing in them is executed.
"""

import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path

# (upstream path under tests/, why it is here)
FILES = [
    # Calculation: Excel's answers, which the engine's must equal.
    ("calc_tests/MATH_AND_TRIGONOMETRY/SUMIFS.xlsx", "calc"),
    ("calc_tests/MATH_AND_TRIGONOMETRY/ROUND.xlsx", "calc"),
        ("calc_tests/MATH_AND_TRIGONOMETRY/LOG_LOG10_LN.xlsx", "calc"),
    ("calc_tests/MATH_AND_TRIGONOMETRY/ATAN2_POWER.xlsx", "calc"),
    ("calc_tests/STATISTICAL/AVERAGE.xlsx", "calc"),
    ("calc_tests/STATISTICAL/COUNT.xlsx", "calc"),
    ("calc_tests/STATISTICAL/GEOMEAN.xlsx", "calc"),
    ("calc_tests/STATISTICAL/SMALL_LARGE.xlsx", "calc"),
    ("calc_tests/STATISTICAL/RANK_EQ_RANK_AVG.xlsx", "calc"),
    ("calc_tests/LOGICAL/IFS.xlsx", "calc"),
    ("calc_tests/TEXT/CONCAT.xlsx", "calc"),
    ("calc_tests/TEXT/CONCATENATE.xlsx", "calc"),
    ("calc_tests/FINANCIAL/PV.xlsx", "calc"),
    ("calc_tests/FINANCIAL/NPER.xlsx", "calc"),
    # Calculation where the engine is known not to agree everywhere yet (the test pins how many cells agree, never fewer).
    ("calc_tests/LOOKUP_AND_REFERENCE/XLOOKUP.xlsx", "gaps"),
    ("calc_tests/LOOKUP_AND_REFERENCE/HVLOOKUP.xlsx", "gaps"),
    ("calc_tests/DATE_AND_TIME/DAYS_DAYS360.xlsx", "gaps"),
    ("calc_tests/MATH_AND_TRIGONOMETRY/SUMIF_AVERAGE_IF.xlsx", "gaps"),
    # Features, as the programs that make them write them.
    ("freeze.xlsx", "features"),
    ("split.xlsx", "features"),
    ("custom_theme_colors.xlsx", "features"),
    ("conditional_formatting/cf_tests.xlsx", "features"),
    ("libreoffice_888_example.xlsx", "features"),
    ("openpyxl_example.xlsx", "features"),
    ("shared_formula_volatile.xlsx", "features"),
    ("missing_r_on_row.xlsx", "features"),
    ("optional_xf_id.xlsx", "features"),
    ("example.xlsx", "features"),
    ("calc_test_no_export/tables.xlsx", "features"),
    ("NoGrid.xlsx", "features"),
    ("basic_text.xlsx", "features"),
    # Whole documents: what people make.
    ("templates/invoice.xlsx", "documents"),
    ("templates/weekly_timesheet.xlsx", "documents"),
    ("templates/travel_expenses_tracker.xlsx", "documents"),
    ("templates/gantt_project_tracker.xlsx", "documents"),
    ("templates/yearly_calendar.xlsx", "documents"),
    ("templates/event_calendar.xlsx", "documents"),
]


def producer(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        book = z.read("xl/workbook.xml").decode("utf-8", "replace")
        if 'calcId="124519"' in book:
            return "openpyxl"
        if 'appName="Calc"' in book:
            return "LibreOffice Calc"
        if "xl/calcChain.xml" in names and "xmlns:xr=" in book:
            return "Microsoft Excel"
        if "docProps/app.xml" in names:
            app = z.read("docProps/app.xml").decode("utf-8", "replace")
            if "<Application>Microsoft Excel" in app:
                return "Microsoft Excel"
            if "openpyxl" in app.lower():
                return "openpyxl"
        return "unknown (the file carries no marker)"


def main():
    src = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / "real"
    out.mkdir(exist_ok=True)
    manifest = []
    taken = set()
    for rel, kind in FILES:
        name = Path(rel).name
        if name in taken:
            name = rel.replace("/", "__")
        taken.add(name)
        shutil.copyfile(src / rel, out / name)
        data = (out / name).read_bytes()
        manifest.append({"file": name, "upstream": f"tests/{rel}", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "producer": producer(out / name), "kind": kind})
    (out / "manifest.json").write_text(
        json.dumps(
            {
                "source": "ironcalc 0.8.3, crates.io (https://crates.io/crates/ironcalc/0.8.3), upstream https://github.com/ironcalc/IronCalc",
                "licence": "MIT OR Apache-2.0, as the crate's Cargo.toml says",
                "files": manifest,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    for m in manifest:
        print(m["file"], m["producer"], m["bytes"])


if __name__ == "__main__":
    main()
