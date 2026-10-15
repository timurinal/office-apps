import { describe, expect, it } from 'vitest';
import { FormatError } from '../errors';
import { part } from '../../sheets/model/structure';
import { openBook } from './book';
import { STYLES, dumpWorkbook, makeXlsx, rawXlsx, sheetXml, type WorkbookDump } from './testing';
import { readXlsx } from './read';

/** The workbook a file makes, laid out by position. */
async function load(bytes: Uint8Array) {
  const out = await readXlsx(bytes);
  return { dump: dumpWorkbook(out.seed), warnings: out.warnings, seed: out.seed };
}

const sheet = (d: WorkbookDump, i = 0) => d.sheets[i]!;

describe('values', () => {
  it('reads numbers, text, booleans, errors and dates as what they are', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Data');
        ws.getCell('A1').value = 12.5;
        ws.getCell('A2').value = 'text';
        ws.getCell('A3').value = true;
        ws.getCell('A4').value = { error: '#N/A' };
        ws.getCell('A5').value = new Date(Date.UTC(2024, 2, 5, 12));
        ws.getCell('A5').numFmt = 'dd/mm/yyyy';
        ws.getCell('A6').value = { richText: [{ text: 'rich ' }, { text: 'text', font: { bold: true } }] };
        ws.getCell('A7').value = '007';
        ws.getCell('A8').value = -0.5;
      })
    );
    const c = sheet(dump).cells;
    expect(c.A1!.v).toBe(12.5);
    expect(c.A2!.v).toBe('text');
    expect(c.A3!.v).toBe(true);
    expect(c.A4!.e).toBe('#N/A');
    // 5 March 2024 at noon, in Excel's serials, shown as a date.
    expect(c.A5!.v).toBeCloseTo(45356.5, 8);
    expect(c.A5!.style).toEqual({ numFmt: 'dd/mm/yyyy' });
    expect(c.A6!.v).toBe('rich text');
    expect(c.A7!.v).toBe('007');
    expect(c.A8!.v).toBe(-0.5);
  });

  it('puts a sheet where the file puts it, and keeps hidden sheets hidden', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        wb.addWorksheet('First').getCell('A1').value = 1;
        wb.addWorksheet('Second', { state: 'hidden' }).getCell('A1').value = 2;
        wb.addWorksheet('Third', { properties: { tabColor: { argb: 'FFFF0000' } } });
      })
    );
    expect(dump.sheets.map((s) => [s.name, s.hidden, s.tab])).toEqual([
      ['First', false, null],
      ['Second', true, null],
      ['Third', false, '#ff0000']
    ]);
  });

  it('shows the first sheet even if the file hides them all', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        wb.addWorksheet('Only', { state: 'hidden' });
      })
    );
    expect(sheet(dump).hidden).toBe(false);
  });
});

describe('formulas', () => {
  it('binds A1 to the workbook, across sheets, and keeps what a person would read', async () => {
    const { dump, warnings } = await load(
      await makeXlsx((wb) => {
        const a = wb.addWorksheet('Sales Q1');
        a.getCell('A1').value = 10;
        a.getCell('A2').value = 20;
        a.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 30 };
        const b = wb.addWorksheet('Summary');
        b.getCell('A1').value = { formula: "'Sales Q1'!A3*2", result: 60 };
        b.getCell('A2').value = { formula: 'IF(A1>50,"big","small")', result: 'big' };
        b.getCell('A3').value = { formula: 'SUM($A$1:A2)', result: 60 };
      })
    );
    expect(sheet(dump, 0).cells.A3).toMatchObject({ f: '=SUM(A1:A2)', v: 30 });
    expect(sheet(dump, 1).cells.A1).toMatchObject({ f: "='Sales Q1'!A3*2", v: 60 });
    expect(sheet(dump, 1).cells.A2).toMatchObject({ f: '=IF(A1>50,"big","small")', v: 'big' });
    expect(sheet(dump, 1).cells.A3!.f).toBe('=SUM($A$1:A2)');
    expect(warnings).toEqual([]);
  });

  it('reads a shared formula in every cell it covers', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml(
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c></row>' +
          '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>' +
          '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>'
      )
    });
    const { dump } = await load(bytes);
    expect([1, 2, 3].map((r) => sheet(dump).cells[`B${r}`]!.f)).toEqual(['=A1*2', '=A2*2', '=A3*2']);
    expect([1, 2, 3].map((r) => sheet(dump).cells[`B${r}`]!.v)).toEqual([2, 4, 6]);
  });

  it('drops the prefix on newer functions, so IFS reads as IFS', async () => {
    const bytes = rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>5</v></c><c r="B1"><f>_xlfn.IFS(A1&gt;3,"a",TRUE,"b")</f><v>a</v></c></row>') });
    const { dump } = await load(bytes);
    expect(sheet(dump).cells.B1).toMatchObject({ f: '=IFS(A1>3,"a",TRUE,"b")', v: 'a' });
  });

  it('keeps the last value of a formula it cannot calculate, and says so', async () => {
    const { dump, warnings } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getCell('A1').value = { formula: 'LAMBDA(x,x+1)(2)', result: 3 };
        ws.getCell('A2').value = { formula: "[1]Other!A1+1", result: 42 };
        ws.getCell('A3').value = { formula: 'NOTAFUNCTION(1)' };
      })
    );
    const c = sheet(dump).cells;
    expect(c.A1).toEqual({ v: 3 });
    expect(c.A2).toEqual({ v: 42 });
    // With nothing to keep, the formula stays and shows what it is.
    expect(c.A3!.f).toBe('=NOTAFUNCTION(1)');
    const messages = warnings.map((w) => w.message);
    expect(messages).toContain('Formulas that use LAMBDA were kept as values.');
    expect(messages).toContain('1 formula could not be read and kept its last value.');
  });

  it('keeps a last value of zero or false, which are values, and of nothing, which is none', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getCell('A1').value = { formula: 'LAMBDA(x,x)(0)', result: 0 };
        ws.getCell('A2').value = { formula: 'LAMBDA(x,x)(FALSE)', result: false };
        ws.getCell('A3').value = { formula: 'LAMBDA(x,x)("")', result: '' };
      })
    );
    expect(sheet(dump).cells.A1).toEqual({ v: 0 });
    expect(sheet(dump).cells.A2).toEqual({ v: false });
    // What showed as nothing is nothing.
    expect(sheet(dump).cells.A3).toBeUndefined();
  });

  it('keeps the cells of an array formula over several cells as values', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml(
        '<row r="1"><c r="A1"><f t="array" ref="A1:A2">TRANSPOSE(B1:C1)</f><v>7</v></c><c r="B1"><v>7</v></c><c r="C1"><v>8</v></c></row><row r="2"><c r="A2"><v>8</v></c></row>'
      )
    });
    const { dump, warnings } = await load(bytes);
    expect(sheet(dump).cells.A1).toEqual({ v: 7 });
    expect(sheet(dump).cells.A2).toEqual({ v: 8 });
    expect(warnings.map((w) => w.message)).toContain('1 array formula was kept as values.');
  });

  it('takes a 1904 workbook\'s dates as the same dates', async () => {
    const bytes = await makeXlsx((wb) => {
      wb.properties.date1904 = true;
      const ws = wb.addWorksheet('Sheet1');
      ws.getCell('A1').value = new Date(Date.UTC(2024, 0, 1));
      ws.getCell('A1').numFmt = 'yyyy-mm-dd';
    });
    const { dump, warnings } = await load(bytes);
    expect(sheet(dump).cells.A1!.v).toBe(45292);
    expect(warnings.map((w) => w.message)).toContain('Dates were converted from the 1904 date system.');
  });
});

describe('formats', () => {
  it('reads fonts, fills, borders, alignment and number formats, and leaves the default font out', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getCell('A1').value = 'plain';
        const b = ws.getCell('B1');
        b.value = 1234.5;
        b.numFmt = '#,##0.00';
        b.font = { name: 'Arial', size: 14, bold: true, italic: true, underline: true, strike: true, color: { argb: 'FFC0392B' } };
        b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        b.alignment = { horizontal: 'right', vertical: 'top', wrapText: true, indent: 2 };
        b.border = { top: { style: 'thin' }, bottom: { style: 'double', color: { argb: 'FF123456' } }, left: { style: 'hair' }, right: { style: 'mediumDashed' } };
        const c = ws.getCell('C1');
        c.value = 'themed';
        c.font = { name: 'Calibri', size: 11, color: { theme: 4, tint: 0.3999755851924192 } as never };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 5 } };
      })
    );
    const c = sheet(dump).cells;
    expect(c.A1!.style).toBeUndefined();
    expect(c.B1!.style).toEqual({
      numFmt: '#,##0.00',
      font: 'Arial',
      size: 14,
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      color: '#c0392b',
      fill: '#fff2cc',
      h: 'right',
      v: 'top',
      wrap: true,
      indent: 2,
      borderTop: { line: 'thin' },
      borderRight: { line: 'medium' },
      borderBottom: { line: 'double', color: '#123456' },
      borderLeft: { line: 'dotted' }
    });
    // Calibri 11 is this workbook's own font, so it is not described; a theme colour is the colour the file's theme gives it
    // (ExcelJS writes the Office 2007 theme: Accent 2 is C0504D, and Accent 1 is 4F81BD, lightened by 40%).
    expect(c.C1!.style!.font).toBeUndefined();
    expect(c.C1!.style!.size).toBeUndefined();
    expect(c.C1!.style!.fill).toBe('#c0504d');
    expect(c.C1!.style!.color).toMatch(/^#9[3-6]b[2-4]d[6-8]$/);
  });

  it('does not carry black text, which a dark sheet could not read', async () => {
    const { dump } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getCell('A1').value = 'x';
        ws.getCell('A1').font = { color: { argb: 'FF000000' }, bold: true };
      })
    );
    expect(sheet(dump).cells.A1!.style).toEqual({ bold: true });
  });

  it('gives a cell in a formatted column or row the format it has, whole', async () => {
    const { dump, seed } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getColumn(2).style = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, font: { bold: true } };
        ws.getCell('B1').value = 'filled by the column';
        ws.getCell('B1').style = { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, font: { bold: true } };
        // B2 has an entry of its own that is plain: it asks for no fill, whatever its column says.
        ws.getCell('B2').value = 'plain';
        ws.getCell('B2').style = { numFmt: '0' };
      })
    );
    const s = sheet(dump);
    expect(s.colStyles[1]).toEqual({ fill: '#ffff00', bold: true });
    // B1 says what its column says, so it says nothing of its own.
    expect(s.cells.B1!.style).toBeUndefined();
    // B2 has an entry of its own, and the layered `null`s that stop the column's fill showing through are not shown by the dump.
    expect(s.cells.B2!.style).toEqual({ numFmt: '0' });
    const book = openBook(seed);
    const b2 = book.cells.get(book.sheets[0]!.id)!.find((c) => c.r === 1 && c.c === 1)!;
    expect(book.styles.get(b2.content.s)).toEqual({ numFmt: '0', fill: null, bold: null });
    // So the cell looks like what the file says it looks like, and not like its column.
    expect(book.styles.effective(part(book.sheets[0]!.map, 'colStyles').get(b2.col), undefined, b2.content.s)).toEqual({ numFmt: '0' });
  });
});

describe('layout', () => {
  it('reads widths, heights, hidden lines, frozen panes and merges', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>head</t></is></c></row><row r="2" ht="60" customHeight="1"><c r="A2"><v>1</v></c></row><row r="3" hidden="1"><c r="A3"><v>2</v></c></row>' +
          '<row r="4" ht="15"><c r="A4"><v>3</v></c></row>',
        {
          before:
            '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
            '<cols><col min="1" max="1" width="20" customWidth="1"/><col min="3" max="3" width="10" hidden="1" customWidth="1"/></cols>',
          after: '<mergeCells count="2"><mergeCell ref="A5:C5"/><mergeCell ref="E1:E1"/></mergeCells>'
        }
      )
    });
    const { dump } = await load(bytes);
    const s = sheet(dump);
    expect(s.widths).toEqual({ 0: 140 });
    expect(s.hiddenCols).toEqual([2]);
    expect(s.heights).toEqual({ 1: 80 });
    expect(s.hiddenRows).toEqual([2]);
    expect(s.frozen).toEqual([1, 1]);
    // A row at the file's default height says nothing; a merge of one cell is no merge.
    expect(s.merges).toEqual(['A5:C5']);
  });

  it('sizes a sheet to its data, and a little over when it is already full', async () => {
    const small = await readXlsx(await makeXlsx((wb) => void (wb.addWorksheet('S').getCell('A1').value = 1)));
    const wide = await readXlsx(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('S');
        ws.getCell(1500, 30).value = 1;
      })
    );
    const sizes = async (seed: typeof small.seed) => {
      const { openBook } = await import('./book');
      const b = openBook(seed);
      return [b.sheets[0]!.rows.length, b.sheets[0]!.cols.length];
    };
    expect(await sizes(small.seed)).toEqual([1000, 26]);
    expect(await sizes(wide.seed)).toEqual([1600, 32]);
  });
});

describe('names, validations, conditional formats and the filter', () => {
  const names = `<definedNames><definedName name="Rate">Sheet1!$A$1</definedName><definedName name="Local" localSheetId="0">Sheet1!$B$1:$B$2</definedName><definedName name="Tax">0.2</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$B$2</definedName></definedNames>`;

  it('reads names of the workbook and of a sheet, constants too, and not the ones Excel keeps for itself', async () => {
    const bytes = rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>Rate*Tax</f><v>0.2</v></c></row>') }, { workbookExtra: names });
    const { dump } = await load(bytes);
    expect(dump.names).toEqual([
      { name: 'Local', scope: 'Sheet1', text: 'Sheet1!$B$1:$B$2' },
      { name: 'Rate', scope: null, text: 'Sheet1!$A$1' },
      { name: 'Tax', scope: null, text: '0.2' }
    ]);
    expect(sheet(dump).cells.B1).toMatchObject({ f: '=Rate*Tax' });
  });

  it('reads a validation list written out, one over a range, and one over another sheet (the way Excel 2010 stores it)', async () => {
    const ext =
      '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">' +
      '<x14:dataValidation type="list" allowBlank="1" showErrorMessage="1"><x14:formula1><xm:f>Lists!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>D1:D10</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst>';
    const bytes = rawXlsx(
      {
        Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', {
          after:
            '<dataValidations count="3">' +
            '<dataValidation type="list" allowBlank="1" showErrorMessage="1" error="Pick one." sqref="A1:A5"><formula1>"red,green, blue"</formula1></dataValidation>' +
            '<dataValidation type="list" sqref="B1:B5"><formula1>$F$1:$F$3</formula1></dataValidation>' +
            '<dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorStyle="warning" sqref="C1:C5 C8"><formula1>1</formula1><formula2>10</formula2></dataValidation>' +
            '</dataValidations>' +
            ext
        }),
        Lists: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>')
      },
      {}
    );
    const { dump } = await load(bytes);
    expect(sheet(dump).validations).toEqual([
      { ranges: ['A1:A5'], check: { kind: 'list', items: ['red', 'green', 'blue'] }, strict: true, message: 'Pick one.' },
      { ranges: ['B1:B5'], check: { kind: 'listRange', sheet: 'Sheet1', range: 'F1:F3' }, allowBlank: false },
      { ranges: ['C1:C5'], check: { kind: 'integer', op: 'between', a: 1, b: 10 } },
      { ranges: ['C8'], check: { kind: 'integer', op: 'between', a: 1, b: 10 } },
      { ranges: ['D1:D10'], check: { kind: 'listRange', sheet: 'Lists', range: 'A1:A3' }, strict: true }
    ]);
  });

  it('reads a validation over a whole column, which Excel itself writes, without making a cell of it for each row', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', {
        after: '<dataValidations count="1"><dataValidation type="list" sqref="A2:A1048576"><formula1>"yes,no"</formula1></dataValidation></dataValidations>'
      })
    });
    const started = performance.now();
    const { dump } = await load(bytes);
    expect(performance.now() - started).toBeLessThan(2000);
    // Held to the sheet, which is 1,000 rows.
    expect(sheet(dump).validations[0]!.ranges).toEqual(['A2:A1000']);
  });

  it('reads conditional formats it has an equivalent for, and counts the ones it has not', async () => {
    const { dump, warnings } = await load(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        for (let r = 1; r <= 6; r++) ws.getCell(r, 1).value = r;
        const style = { font: { bold: true, color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } as const;
        ws.addConditionalFormatting({
          ref: 'A1:A6',
          rules: ([
            { type: 'cellIs', operator: 'greaterThan', formulae: [3], priority: 1, style },
            { type: 'cellIs', operator: 'equal', formulae: ['$B$1'], priority: 2, style },
            { type: 'expression', formulae: ['MOD(A1,2)=0'], priority: 3, style },
            { type: 'top10', rank: 2, priority: 4, style },
            { type: 'aboveAverage', aboveAverage: false, priority: 5, style },
            { type: 'colorScale', cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FF63BE7B' }], priority: 6 },
            { type: 'expression', formulae: ['NOT(ISERROR(SEARCH("ab",A1)))'], priority: 8, style }
          ] as unknown) as never[]
        });
      })
    );
    const rules = sheet(dump).cf;
    expect(rules.map((r) => r.when)).toEqual([
      { kind: 'cell', op: 'gt', a: 3 },
      { kind: 'formula', f: '=A1=$B$1' },
      { kind: 'formula', f: '=MOD(A1,2)=0' },
      { kind: 'top', n: 2 },
      { kind: 'average', below: true },
      { kind: 'scale', min: '#ffffff', max: '#63be7b' },
      { kind: 'text', op: 'contains', text: 'ab' }
    ]);
    expect(rules[0]!.style).toEqual({ color: '#9c0006', bold: true, fill: '#ffc7ce' });
    expect(rules[0]!.ranges).toEqual(['A1:A6']);
    expect(warnings).toEqual([]);
  });

  it('reads a data bar, counts an icon set, which is not drawn here, and keeps the rule beside them', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', {
        after:
          '<conditionalFormatting sqref="A1:A6"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>' +
          '<conditionalFormatting sqref="B1:B6"><cfRule type="iconSet" priority="2"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule></conditionalFormatting>' +
          '<conditionalFormatting sqref="C1:C6"><cfRule type="duplicateValues" dxfId="0" priority="3"/></conditionalFormatting>'
      }),
    }, {
      parts: { 'xl/styles.xml': STYLES.replace('</styleSheet>', '<dxfs count="1"><dxf><font><b/></font></dxf></dxfs></styleSheet>') }
    });
    const { dump, warnings } = await load(bytes);
    expect(sheet(dump).cf.map((r) => r.when)).toEqual([{ kind: 'bar', color: '#638ec6' }, { kind: 'duplicate' }]);
    expect(warnings.map((w) => w.message)).toContain('1 conditional format drawn as icons was left out.');
  });

  it('reads the range a filter covers, and says that its criteria did not come', async () => {
    const bytes = rawXlsx({
      Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row><row r="2" hidden="1"><c r="A2"><v>2</v></c></row>', {
        after: '<autoFilter ref="A1:C10"><filterColumn colId="0"><filters><filter val="1"/></filters></filterColumn></autoFilter>'
      })
    });
    const { dump, warnings } = await load(bytes);
    expect(sheet(dump).filter).toBe('A1:C10');
    expect(sheet(dump).hiddenRows).toEqual([1]);
    expect(warnings.map((w) => w.code)).toContain('filter');
  });
});

describe('what is left out', () => {
  it('counts links, pictures, charts and tables, and keeps the text', async () => {
    const bytes = rawXlsx(
      {
        Sheet1: sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>click</t></is></c></row>', {
          after: '<hyperlinks><hyperlink ref="A1" r:id="rId1"/><hyperlink ref="A2" location="B2"/></hyperlinks><drawing r:id="rId2"/><tableParts count="1"><tablePart r:id="rId3"/></tableParts>'
        })
      },
      {
        parts: {
          'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>',
          'xl/charts/chart1.xml': '<c/>',
          'xl/media/image1.png': new Uint8Array(8),
          'xl/pivotTables/pivotTable1.xml': '<p/>'
        }
      }
    );
    const { dump, warnings } = await load(bytes);
    expect(sheet(dump).cells.A1!.v).toBe('click');
    const messages = warnings.map((w) => w.message);
    expect(messages).toEqual(
      expect.arrayContaining(['1 chart was left out.', '1 picture was left out.', '1 pivot table was kept as values.', 'Links in 2 cells were left out.', '1 table was kept as plain cells.'])
    );
  });
});

describe('what it refuses', () => {
  const refusal = async (bytes: Uint8Array) => {
    try {
      await readXlsx(bytes);
    } catch (e) {
      if (e instanceof FormatError) return e.code;
      throw e;
    }
    return null;
  };

  it('is told when a file is not a spreadsheet', async () => {
    expect(await refusal(new TextEncoder().encode('just some text that is longer than a zip signature needs'))).toBe('not_xlsx');
    expect(await refusal(rawXlsx({}, { workbook: '<notaworkbook xmlns="urn:x"/>' }))).toBe('not_xlsx');
  });

  it('is told when a file is a password-protected workbook or an .xls', async () => {
    const ole = new Uint8Array(2048);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await refusal(ole)).toBe('unsupported');
  });

  it('refuses a workbook with a sheet made only of what is not read, rather than an empty document', async () => {
    const bytes = rawXlsx({}, { sheetNames: [], workbook: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>' });
    expect(await refusal(bytes)).toBe('empty');
  });
});
