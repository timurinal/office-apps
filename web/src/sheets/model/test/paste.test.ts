/** Paste: Excel's and Google's HTML as they put it on the clipboard, plain text, and our own copy. */

import { describe, expect, it } from 'vitest';
import { isDateFormat } from '../../engine';
import { at, edit, grid, room, text, type } from './helpers';

/** What Excel for Windows writes for A1:B3, cut down to the parts it always has. */
const EXCEL = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<meta name=Generator content="Microsoft Excel 15">
<style>
<!--table
	{mso-displayed-decimal-separator:"\\.";
	mso-displayed-thousand-separator:"\\,";}
td
	{padding-top:1px;
	padding-right:1px;
	padding-left:1px;
	mso-ignore:padding;
	color:black;
	font-size:11.0pt;
	font-weight:400;
	font-style:normal;
	text-decoration:none;
	font-family:Calibri, sans-serif;
	mso-font-charset:0;
	mso-number-format:General;
	text-align:general;
	vertical-align:bottom;
	border:none;
	mso-background-source:auto;
	mso-pattern:auto;
	white-space:nowrap;}
.xl65
	{font-weight:700;}
.xl66
	{mso-number-format:"\\0022\\00A3\\0022\\#\\,\\#\\#0\\.00";}
.xl67
	{mso-number-format:"Short Date";}
.xl68
	{background:yellow;
	mso-pattern:black none;}
-->
</style>
</head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:collapse;width:96pt'>
<!--StartFragment-->
 <col width=64 span=2 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Item</td>
  <td class=xl65 width=64 style='width:48pt'>Cost</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>Rent</td>
  <td class=xl66 align=right x:num="950.5">£950.50</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl68 style='height:15.0pt'>Paid</td>
  <td class=xl67 align=right x:num="45292">01/01/2024</td>
 </tr>
<!--EndFragment-->
</table>
</body>
</html>`;

/** What Google Sheets writes for A1:B2: a formula in R1C1, a text that looks like a number, a percentage. */
const GOOGLE =
  `<meta charset='utf-8'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>` +
  `<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">` +
  `<colgroup><col width="100"/><col width="100"/></colgroup><tbody>` +
  `<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:4}">4</td>` +
  `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:8}" data-sheets-formula="=R[0]C[-1]*2">8</td></tr>` +
  `<tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;font-weight:bold;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;007&quot;}">007</td>` +
  `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:0.25}" data-sheets-numberformat="{&quot;1&quot;:3,&quot;2&quot;:&quot;0%&quot;,&quot;3&quot;:1}">25%</td></tr>` +
  `</tbody></table>`;

const two = () => {
  const r = room();
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

describe('from Excel', () => {
  it('values, number formats, bold and fill; Excel\'s defaults are no format', () => {
    const { a, b, room: r, sheet } = two();
    a.setStyle(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, { italic: true });
    a.paste(sheet, at('A1'), 'Item\tCost\nRent\t£950.50\nPaid\t01/01/2024\n', EXCEL);
    r.flush();
    expect(grid(b, sheet, 3, 2)).toEqual([
      ['Item', 'Cost'],
      ['Rent', '£950.50'],
      ['Paid', '01/01/2024']
    ]);
    const v = b.view(sheet);
    expect(v.cell(0, 0)?.style).toEqual({ bold: true });
    expect(v.cell(1, 1)?.value).toBe(950.5);
    expect(v.cell(1, 1)?.style).toEqual({ numFmt: '"£"#,##0.00' });
    expect(v.cell(2, 0)?.style.fill).toBe('yellow');
    expect(v.cell(2, 1)?.value).toBe(45292);
    expect(isDateFormat(v.cell(2, 1)?.style.numFmt)).toBe(true);
    expect(v.cell(1, 0)?.style).toEqual({});
  });
});

describe('from Google Sheets', () => {
  it('a formula lands relative to where it lands; exact values and number formats stand', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'C5', 'gone');
    a.paste(sheet, at('C5'), '4\t8\n007\t25%', GOOGLE);
    r.flush();
    expect(grid(b, sheet, 6, 4).slice(4)).toEqual([
      ['', '', '4', '8'],
      ['', '', '007', '25%']
    ]);
    expect(edit(b, sheet, 'D5')).toBe('=C5*2');
    expect(edit(b, sheet, 'C6')).toBe("'007");
    expect(b.view(sheet).cell(5, 2)?.style).toEqual({ bold: true });
    expect(b.view(sheet).cell(5, 3)?.value).toBe(0.25);
    a.undo();
    r.flush();
    expect(text(b, sheet, 'C5')).toBe('gone');
    expect(text(b, sheet, 'D5')).toBe('');
  });
});

describe('plain text', () => {
  it('each field read as if typed, quoted fields whole, and the target keeps its formats', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, { italic: true });
    a.paste(sheet, at('A1'), '1\t=A1+1\n\'x\t"a\tb"\n');
    expect(grid(a, sheet, 2, 2)).toEqual([
      ['1', '2'],
      ['x', 'a\tb']
    ]);
    expect(a.view(sheet).cell(0, 0)?.style.italic).toBe(true);
  });
});

describe('our own copy', () => {
  it('a copy shifts its formulas; a cut moves them and empties where it was', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '2');
    type(a, sheet, 'A2', '=A1*3');
    a.setStyle(sheet, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
    const clip = a.view(sheet).copy({ r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(clip.text).toBe('2\n6');
    a.paste(sheet, at('C1'), clip.text, clip.html);
    expect(edit(a, sheet, 'C2')).toBe('=C1*3');
    expect(a.view(sheet).cell(1, 2)?.style.bold).toBe(true);

    // Another person in the same workbook pastes it as formulas too.
    b.paste(sheet, at('E1'), clip.text, clip.html);
    r.flush();
    expect(edit(a, sheet, 'E2')).toBe('=E1*3');

    type(a, sheet, 'J1', '=A1+A2+A3');
    a.setName('Base', '=Sheet1!$A$1');
    a.paste(sheet, at('G3'), clip.text, clip.html, { r1: 0, c1: 0, r2: 1, c2: 0 });
    r.flush();
    for (const m of [a, b]) {
      expect(text(m, sheet, 'A1')).toBe('');
      expect(text(m, sheet, 'A2')).toBe('');
      expect(edit(m, sheet, 'G4')).toBe('=G3*3');
      expect(text(m, sheet, 'G4')).toBe('6');
      // What read the cells follows them; what reached past them does not.
      expect(edit(m, sheet, 'J1')).toBe('=G3+G4+A3');
      expect(m.engine.displayName('Base')).toBe('=Sheet1!$G$3');
    }
    a.undo();
    r.flush();
    expect(edit(b, sheet, 'J1')).toBe('=A1+A2+A3');
    expect(text(b, sheet, 'A2')).toBe('6');
  });

  it('from another workbook it is a table of values', () => {
    const one = two();
    type(one.a, one.sheet, 'A1', '2');
    type(one.a, one.sheet, 'A2', '=A1*3');
    const clip = one.a.view(one.sheet).copy({ r1: 0, c1: 0, r2: 1, c2: 0 });
    const other = room(undefined, 1, 'another');
    const m = other.people[0]!.model;
    m.paste(other.sheet, at('B1'), clip.text, clip.html);
    expect(edit(m, other.sheet, 'B2')).toBe('6');
  });
});
