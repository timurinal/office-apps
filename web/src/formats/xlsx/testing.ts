/**
 * What the xlsx tests share: a workbook built in memory, and a workbook (a seed, or what the model
 * saves) laid out as plain data by position so that two of them can be compared with `toEqual`.
 * Not shipped; the tests are the only importers.
 */

import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';
import { cellAddress } from '../../sheets/engine';
import type { Rect } from '../../sheets/grid/types';
import { FILTER_RANGE, type CfRule, type ValidationRule } from '../../sheets/model/features';
import { type IdRect, field, namesOf, part, resolveRect } from '../../sheets/model/structure';
import { type BookFile, openBook } from './book';
import { printA1 } from '../../sheets/engine/parser';
import { parseStored } from '../../sheets/engine';

/** A workbook made with ExcelJS and written to bytes. */
export async function makeXlsx(build: (wb: ExcelJS.Workbook) => void | Promise<void>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await build(wb);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export interface CellDump {
  /** A value; a formula is its calculated value. */
  v?: number | string | boolean;
  e?: string;
  /** The formula as a person reads it, with its `=`. */
  f?: string;
  style?: Record<string, unknown>;
}

export interface SheetDump {
  name: string;
  hidden: boolean;
  tab: string | null;
  frozen: [number, number];
  cells: Record<string, CellDump>;
  widths: Record<number, number>;
  heights: Record<number, number>;
  hiddenRows: number[];
  hiddenCols: number[];
  merges: string[];
  /** Per line, by index. */
  colStyles: Record<number, Record<string, unknown>>;
  rowStyles: Record<number, Record<string, unknown>>;
  cf: { ranges: string[]; when: unknown; style: unknown; stop?: boolean }[];
  validations: { ranges: string[]; check: unknown; strict?: boolean; allowBlank?: boolean; message?: string }[];
  filter: string | null;
}

export interface WorkbookDump {
  sheets: SheetDump[];
  names: { name: string; scope: string | null; text: string }[];
}

/** What a Yjs map and a JS map both are. */
interface Entries<T> {
  entries(): IterableIterator<[string, T]>;
  keys(): IterableIterator<string>;
}

const rangeText = (r: Rect): string => (r.r1 === r.r2 && r.c1 === r.c2 ? cellAddress(r.r1, r.c1) : `${cellAddress(r.r1, r.c1)}:${cellAddress(r.r2, r.c2)}`);

/** A format without what is only another way to say the default: the middle, the workbook's own font. */
export function plainStyle(style: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === null || v === undefined) continue;
    if (k === 'v' && v === 'middle') continue;
    if (k === 'h' && v === 'general') continue;
    if (k === 'font' && v === 'Calibri') continue;
    if (k === 'size' && v === 11) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The `null` entries of a layered format say "the default here"; for comparing, they say nothing. */
const layer = (style: Record<string, unknown> | undefined): Record<string, unknown> | undefined => (style ? plainStyle(style) : undefined);

export function dumpWorkbook(file: BookFile): WorkbookDump {
  const book = openBook(file);
  const sheets: SheetDump[] = [];
  for (const s of book.sheets) {
    const sheet = book.engine.sheet(s.id)!;
    const ri = sheet.rowIndex();
    const ci = sheet.colIndex();
    const cells: Record<string, CellDump> = {};
    // What a merge covers is not shown, and a file written from the model does not hold it.
    const covered = [...part(s.map, 'merges').values()].map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null);
    const under = (r: number, c: number) => covered.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2 && !(r === m.r1 && c === m.c1));
    const colStyleIds = part(s.map, 'colStyles');
    const rowStyleIds = part(s.map, 'rowStyles');
    for (const c of book.cells.get(s.id) ?? []) {
      const dump: CellDump = {};
      const hidden = under(c.r, c.c);
      const v = hidden ? null : book.engine.getValue(s.id, c.row, c.col);
      if (c.content.f !== undefined && !hidden) dump.f = book.engine.displayFormula(s.id, c.row, c.col) ?? c.content.f;
      if (v !== null) {
        if (typeof v === 'object') dump.e = v.code;
        else dump.v = v;
      }
      if (c.content.e !== undefined && dump.e === undefined && !hidden) dump.e = c.content.e;
      const raw = book.styles.get(c.content.s);
      const own = raw ? layer(raw as Record<string, unknown>) : undefined;
      if (own) dump.style = own;
      if (Object.keys(dump).length) cells[cellAddress(c.r, c.c)] = dump;
    }
    const byIndex = <T>(map: Entries<T>, index: Map<string, number>): Record<number, T> => {
      const out: Record<number, T> = {};
      for (const [id, x] of map.entries()) {
        const i = index.get(id);
        if (i !== undefined) out[i] = x;
      }
      return out;
    };
    const lines = (m: Entries<unknown>, index: Map<string, number>): number[] =>
      [...m.keys()].map((id) => index.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
    const styled = (m: Entries<string>, index: Map<string, number>): Record<number, Record<string, unknown>> => {
      const out: Record<number, Record<string, unknown>> = {};
      for (const [id, styleId] of m.entries()) {
        const i = index.get(id);
        const st = layer(book.styles.get(styleId) as Record<string, unknown> | undefined);
        if (i !== undefined && st) out[i] = st;
      }
      return out;
    };
    const rects = (list: IdRect[]) => list.map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null).map(rangeText);
    const stored = (f: string) => printA1(parseStored(f), book.engine.locator(sheet));
    const cf = [...part(s.map, 'cf').values()] as CfRule[];
    cf.sort((a, b) => a.priority - b.priority);
    const filterRange = field(s.map, 'filter')?.get(FILTER_RANGE) as IdRect | undefined;
    const fr = filterRange && resolveRect(sheet, filterRange);
    sheets.push({
      name: s.name,
      hidden: !!field(s.map, 'hidden'),
      tab: (field(s.map, 'tab') as string | undefined) ?? null,
      frozen: [Number(field(s.map, 'frozenRows') ?? 0), Number(field(s.map, 'frozenCols') ?? 0)],
      cells,
      widths: byIndex(part(s.map, 'widths'), ci),
      heights: byIndex(part(s.map, 'heights'), ri),
      hiddenRows: lines(part(s.map, 'hiddenRows'), ri),
      hiddenCols: lines(part(s.map, 'hiddenCols'), ci),
      merges: [...part(s.map, 'merges').values()].map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null).map(rangeText).sort(),
      colStyles: styled(colStyleIds, ci),
      rowStyles: styled(rowStyleIds, ri),
      cf: cf.map((r) => ({
        ranges: rects(r.ranges),
        when: r.when.kind === 'formula' ? { kind: 'formula', f: stored(r.when.f) } : r.when,
        style: r.style,
        ...(r.stop ? { stop: true } : {})
      })),
      // A rule over two ranges is written as two (a file keys a validation by its range), so they are compared that way.
      validations: ([...part(s.map, 'validation').values()] as ValidationRule[]).flatMap((v) => rects(v.ranges).map((range) => ({ v, range }))).map(({ v, range }) => ({
        ranges: [range],
        check:
          v.check.kind === 'formula'
            ? { kind: 'formula', f: stored(v.check.f) }
            : v.check.kind === 'listRange'
              ? { kind: 'listRange', sheet: book.sheets.find((x) => x.id === (v.check as { sheet: string }).sheet)?.name, range: (() => { const t = book.engine.sheet((v.check as { sheet: string }).sheet); const r = t && resolveRect(t, (v.check as { range: IdRect }).range); return r ? rangeText(r) : null; })() }
              : v.check,
        ...(v.strict ? { strict: true } : {}),
        ...(v.allowBlank === false ? { allowBlank: false } : {}),
        ...(v.message ? { message: v.message } : {})
      })).sort((a, b) => (a.ranges[0]! < b.ranges[0]! ? -1 : 1)),
      filter: fr ? rangeText(fr) : null
    });
  }
  const names = [...namesOf(book.doc).values()].map((n) => {
    const host = n.scope ?? book.sheets[0]?.id;
    const sheet = host ? book.engine.sheet(host) : undefined;
    return { name: n.name, scope: n.scope ? (book.engine.sheet(n.scope)?.name ?? null) : null, text: sheet ? printA1(parseStored(n.f), book.engine.locator(sheet)).replace(/^=/, '') : n.f };
  });
  names.sort((a, b) => (a.name + (a.scope ?? '')).localeCompare(b.name + (b.scope ?? '')));
  return { sheets, names };
}

// ── hand-made packages ──────────────────────────────────────────────────────


const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

export const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`;

export interface RawParts {
  /** Replaces the whole `xl/workbook.xml`. */
  workbook?: string;
  /** Inside `<workbook>`, after `<sheets>`: definedNames and so on. */
  workbookExtra?: string;
  /** Sheet names in order; each is `xl/worksheets/sheetN.xml` from `sheets[name]`, default empty. */
  sheetNames?: string[];
  /** Everything else, by part name; a part given here wins. */
  parts?: Record<string, string | Uint8Array>;
}

/** The XML of a worksheet around `body`: `before` goes ahead of `<sheetData>` and `after` behind it. */
export function sheetXml(body: string, opts: { before?: string; after?: string; attrs?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}" xmlns:r="${REL}"${opts.attrs ?? ''}>${opts.before ?? ''}<sheetData>${body}</sheetData>${opts.after ?? ''}</worksheet>`;
}

/** A package that is just enough to be a workbook, with the sheets' XML as given. */
export function rawXlsx(sheets: Record<string, string>, extra: RawParts = {}): Uint8Array {
  const names = extra.sheetNames ?? Object.keys(sheets);
  const sheetEntries = names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbook =
    extra.workbook ??
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheetEntries}</sheets>${extra.workbookExtra ?? ''}</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">${names
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}</Relationships>`;
  const files: Record<string, string | Uint8Array> = {
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': rels,
    'xl/styles.xml': STYLES,
    ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheets[n] ?? sheetXml('')])),
    ...(extra.parts ?? {})
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
}
