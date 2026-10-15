#!/usr/bin/env python3
"""
Open exported workbooks with openpyxl, a reader that is not ours, and report what it finds.

    python -I check_xlsx.py DIR

For every `<name>.xlsx` in DIR with a `<name>.check.json` beside it, the file must load, formulas and values both
(`load_workbook` and `load_workbook(data_only=True)`), and what openpyxl sees must agree with the check file, which
is what our own reader found in the file that was exported: sheets, their state and order, frozen panes, merges, sizes,
hidden lines, tab colours, conditional formats and validations, the filter, defined names, and the values and formulas
of the cells the check file lists. The report is JSON on stdout, one object per file; the exit status is 1 if any
file has a problem.

Run it with `python -I` (isolated): the files, even our own, are not to be trusted to import code.
LibreOffice is not part of this check: it is not installed on the machine this was written on.
"""

import json
import re
import sys
import warnings
from datetime import date, datetime, time
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import to_excel

ERRORS = {"#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!"}


def xl_value(v):
    if isinstance(v, (datetime, date, time)):
        return to_excel(v)
    return v


def close(a, b):
    # A formula that comes to "" is cached as an empty string, which openpyxl reads as nothing.
    if b == "" and a is None:
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b or a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-8 * max(1.0, abs(b))
    return a == b


def strip_prefix(f):
    return re.sub(r"_xl(?:fn|ws|pm)\.", "", f)


def check(path: Path):
    expect = json.loads(path.with_suffix(".check.json").read_text(encoding="utf-8"))
    problems = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
        data = openpyxl.load_workbook(path, data_only=True)
    names = [s["name"] for s in expect["sheets"]]
    if wb.sheetnames != names:
        problems.append(f"sheet names {wb.sheetnames} != {names}")
        return problems
    for s in expect["sheets"]:
        ws = wb[s["name"]]
        wd = data[s["name"]]
        tag = s["name"]
        want_state = "hidden" if s["hidden"] else "visible"
        if ws.sheet_state != want_state:
            problems.append(f"{tag}: state {ws.sheet_state} != {want_state}")
        r, c = s["frozen"]
        want_freeze = f"{get_column_letter(c + 1)}{r + 1}" if r or c else None
        if ws.freeze_panes != want_freeze:
            problems.append(f"{tag}: freeze {ws.freeze_panes} != {want_freeze}")
        if len(ws.merged_cells.ranges) != len(s["merges"]):
            problems.append(f"{tag}: {len(ws.merged_cells.ranges)} merges != {len(s['merges'])}")
        tab = ws.sheet_properties.tabColor.rgb[-6:].lower() if ws.sheet_properties.tabColor and isinstance(ws.sheet_properties.tabColor.rgb, str) else None
        if (s["tab"] or None) != (("#" + tab) if tab else None):
            problems.append(f"{tag}: tab colour {tab} != {s['tab']}")
        # A file groups neighbouring columns that look alike into one `<col min max>`, which openpyxl keys by the first.
        cols = {}
        for dim in ws.column_dimensions.values():
            for i in range(dim.min or 0, (dim.max or 0) + 1):
                cols[i] = dim
        for idx, px in s["widths"].items():
            dim = cols.get(int(idx) + 1)
            got = dim.width if dim else None
            if got is None or abs(got - px / 7) > 0.02:
                problems.append(f"{tag}: column {idx} width {got} != {px / 7}")
        for idx in s["hiddenCols"]:
            dim = cols.get(idx + 1)
            if not (dim and dim.hidden):
                problems.append(f"{tag}: column {idx} is not hidden")
        for idx, px in s["heights"].items():
            got = ws.row_dimensions[int(idx) + 1].height
            if got is None or abs(got - px * 0.75) > 0.05:
                problems.append(f"{tag}: row {idx} height {got} != {px * 0.75}")
        for idx in s["hiddenRows"]:
            if not ws.row_dimensions[idx + 1].hidden:
                problems.append(f"{tag}: row {idx} is not hidden")
        cf = sum(len(group.rules) for group in ws.conditional_formatting)
        if cf != s["cf"]:
            problems.append(f"{tag}: {cf} conditional format rules != {s['cf']}")
        dv = sum(len(str(d.sqref).split()) for d in ws.data_validations.dataValidation)
        if dv != s["validations"]:
            problems.append(f"{tag}: {dv} validation ranges != {s['validations']}")
        if (ws.auto_filter.ref or None) != s["filter"]:
            problems.append(f"{tag}: filter {ws.auto_filter.ref} != {s['filter']}")
        for ref, cell in s["cells"].items():
            got_f = ws[ref].value
            got_v = wd[ref].value
            if "f" in cell:
                if not (isinstance(got_f, str) and got_f.startswith("=")):
                    problems.append(f"{tag}!{ref}: not a formula: {got_f!r}")
                elif strip_prefix(got_f)[1:] != cell["f"][1:]:
                    problems.append(f"{tag}!{ref}: formula {got_f} != {cell['f']}")
            if "e" in cell:
                if got_v != cell["e"]:
                    problems.append(f"{tag}!{ref}: error {got_v!r} != {cell['e']}")
            elif "v" in cell:
                if not close(xl_value(got_v), cell["v"]):
                    problems.append(f"{tag}!{ref}: value {got_v!r} != {cell['v']!r}")
            if len(problems) > 20:
                return problems
    got_names = sorted(
        [(n, None, d.attr_text) for n, d in wb.defined_names.items()]
        + [(n, ws.title, d.attr_text) for ws in wb.worksheets for n, d in ws.defined_names.items()],
        key=lambda t: (t[0], t[1] or ""),
    )
    want_names = sorted([(n["name"], n["scope"], n["text"]) for n in expect["names"]], key=lambda t: (t[0], t[1] or ""))
    norm = lambda t: (t[0], t[1], strip_prefix(t[2]).lstrip("="))
    if [norm(t) for t in got_names] != [norm(t) for t in want_names]:
        problems.append(f"names {got_names} != {want_names}")
    return problems


def main():
    folder = Path(sys.argv[1])
    report = []
    failed = False
    for path in sorted(folder.glob("*.xlsx")):
        entry = {"file": path.name}
        try:
            problems = check(path)
        except Exception as e:  # a reader that cannot open it has said what it has to say
            problems = [f"{type(e).__name__}: {e}"]
        entry["problems"] = problems
        failed = failed or bool(problems)
        report.append(entry)
    print(json.dumps(report, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
