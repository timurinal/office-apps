#!/usr/bin/env python3
"""
The two files of the corpus that must be refused. Neither is large; both say a great deal.

    python -I make_hostile.py OUT_DIR

zip-bomb.xlsx            a sheet that declares 72 MiB and is 72 KiB. The directory says so before anything is inflated,
                         and the reader's limit on what a package may expand to is 64 MiB.
entity-declaration.xlsx  a sheet with a DOCTYPE that declares entities, the second of them one that expands ten times
                         over each time it is used (the billion laughs), and a reference to a file on the reader's disk
                         (an XML external entity). A reader that resolves entities reads the file or runs out of memory;
                         this one refuses the document for having a DOCTYPE at all.
"""

import sys
import zipfile
from pathlib import Path

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    "</Types>"
)
ROOT_RELS = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
WORKBOOK = f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{NS}" xmlns:r="{REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
WORKBOOK_RELS = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
STYLES = f'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>'


def package(path: Path, sheet, extra=None):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("xl/workbook.xml", WORKBOOK)
        z.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        z.writestr("xl/styles.xml", STYLES)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
        for name, data in (extra or {}).items():
            z.writestr(name, data)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    head = f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><!--'
    tail = "--></worksheet>"
    filler = " " * (72 * 1024 * 1024)
    package(out / "zip-bomb.xlsx", head + filler + tail)

    laughs = (
        '<!DOCTYPE worksheet ['
        '<!ENTITY a "ha">'
        '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
        '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">'
        '<!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">'
        '<!ENTITY x SYSTEM "file:///etc/passwd">'
        "]>"
    )
    sheet = f'<?xml version="1.0" encoding="UTF-8"?>{laughs}<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&d;&x;</t></is></c></row></sheetData></worksheet>'
    package(out / "entity-declaration.xlsx", sheet)


if __name__ == "__main__":
    main()
