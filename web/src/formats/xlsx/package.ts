/**
 * An xlsx package, opened for reading by someone who does not trust it.
 *
 * Everything that has to be true of the file before ExcelJS sees a byte of it is decided here:
 *
 *   · the zip's directory is within the shared limits (`../zip.ts`), counted before anything is
 *     inflated;
 *   · no part that is going to be parsed has a DOCTYPE or an entity declaration;
 *   · the cells the sheets claim are counted on the text, so a workbook of millions is refused
 *     before ExcelJS builds an object for each;
 *   · every sheet is rewritten without the parts ExcelJS expands (`sheetxml.ts`), and the
 *     workbook's names are taken out of workbook.xml, because ExcelJS turns a name's range into
 *     one entry per cell.
 *
 * What ExcelJS is then given is a new, uncompressed package with only the parts it reads. That
 * is also what keeps it from inflating pictures, charts and whatever else a file carries
 * for itself: those are counted here from the directory and never opened.
 */

import { zipSync } from 'fflate';
import { FormatError } from '../errors';
import { MAX_FILE_BYTES } from '../limits';
import { Warnings, plural } from '../types';
import { decodeXml, descendants, elements, parseXml, type XNode } from '../xml';
import { openZip } from '../zip';
import { OFFICE_THEME, themeSlots } from './colors';
import { MAX_NAMES, MAX_RAW_CELLS, MAX_SHEETS } from './limits';
import { type SheetFacts, scanSheet, withoutChild } from './sheetxml';

export interface WorkbookSheet {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  /** The sheet's part, if it is a worksheet and a standard-named one. */
  part: string | null;
}

export interface WorkbookName {
  name: string;
  /** The index of the sheet it belongs to, in workbook order, or null for the workbook. */
  scope: number | null;
  /** The definition as written: `Sheet1!$A$1:$B$4`, `0.2`, `SUM(…)`. */
  text: string;
}

export interface WorkbookFacts {
  date1904: boolean;
  sheets: WorkbookSheet[];
  names: WorkbookName[];
  /** Twelve colours, as `theme="n"` numbers them. */
  theme: string[];
  /** The workbook's "Normal" font, which cells wearing it are not described as having. */
  defaultFont: { name?: string; size?: number };
}

export interface OpenedXlsx {
  /** What ExcelJS reads: a package of the same parts, sanitised, stored. */
  excelBytes: Uint8Array;
  book: WorkbookFacts;
  /** Per sheet, by name. */
  sheets: Map<string, SheetFacts>;
  warnings: Warnings;
}

/** An OLE2 compound file: what Excel makes of a password-protected workbook, and what `.xls` is. */
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

/**
 * The XML parts that are read, by name; everything else in the package is counted and left shut.
 * A sheet's own relationships are not among them: they point at links, comments, tables and
 * drawings, none of which are read, and ExcelJS follows every one it is given.
 */
const READ = /^(?:_rels\/\.rels|xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|theme\/[^/]+\.xml|worksheets\/sheet\d+\.xml))$/;

const DOCTYPE = /<!\s*(?:DOCTYPE|ENTITY)/i;

/** An element's name without its namespace: SpreadsheetML has two (transitional and strict) and this reads both. */
export const local = (n: XNode): string => n.name.replace(/^\{[^}]*\}/, '');

const kids = (n: XNode | null | undefined, name: string): XNode[] => (n ? elements(n).filter((c) => local(c) === name) : []);
const first = (n: XNode | null | undefined, name: string): XNode | null => kids(n, name)[0] ?? null;

const bool = (v: string | undefined): boolean => v === '1' || v === 'true';

function textOf(n: XNode): string {
  return n.children.filter((c): c is string => typeof c === 'string').join('');
}

/** Relationship id to target, from a `.rels` part. */
function relationships(bytes: Uint8Array | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!bytes) return out;
  const root = parseXml(bytes);
  for (const r of descendants(root, 'rel:Relationship')) {
    const id = r.attrs.Id;
    const target = r.attrs.Target;
    if (id && target && r.attrs.TargetMode !== 'External') out.set(id, target);
  }
  return out;
}

/** A relationship target as a package path: relative to `xl/`, or absolute. */
function resolveTarget(target: string): string {
  const t = target.replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  const parts = ['xl'];
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function readWorkbook(bytes: Uint8Array, rels: Map<string, string>): Pick<WorkbookFacts, 'date1904' | 'sheets' | 'names'> {
  const root = parseXml(bytes);
  if (local(root) !== 'workbook') throw new FormatError('not_xlsx', 'workbook.xml has no workbook');
  const pr = first(root, 'workbookPr');
  const sheets: WorkbookSheet[] = [];
  for (const s of kids(first(root, 'sheets'), 'sheet')) {
    const name = s.attrs.name;
    if (!name) continue;
    const state = s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden' ? s.attrs.state : 'visible';
    const target = rels.get(s.attrs['r:id'] ?? '');
    const part = target ? resolveTarget(target) : null;
    sheets.push({ name, state, part: part && /^xl\/worksheets\/sheet\d+\.xml$/.test(part) ? part : null });
  }
  if (sheets.length > MAX_SHEETS) throw new FormatError('sheet_too_large', `${sheets.length} sheets`);
  const names: WorkbookName[] = [];
  for (const d of kids(first(root, 'definedNames'), 'definedName')) {
    const name = d.attrs.name;
    // `_xlnm.` names are Excel's own (print areas, the filter's range); a hidden name is a tool's bookkeeping.
    if (!name || name.startsWith('_xlnm.') || bool(d.attrs.hidden)) continue;
    const scope = d.attrs.localSheetId === undefined ? null : Number(d.attrs.localSheetId);
    if (scope !== null && !(Number.isInteger(scope) && scope >= 0 && scope < sheets.length)) continue;
    names.push({ name, scope, text: textOf(d).trim() });
    if (names.length > MAX_NAMES) break;
  }
  return { date1904: bool(pr?.attrs.date1904), sheets, names };
}

function readTheme(bytes: Uint8Array | null): string[] {
  if (!bytes) return [...OFFICE_THEME];
  const root = parseXml(bytes);
  const scheme = descendants(root, 'a:clrScheme')[0];
  if (!scheme) return [...OFFICE_THEME];
  const byName: Record<string, string> = {};
  for (const c of elements(scheme)) {
    const inner = elements(c)[0];
    if (!inner) continue;
    const hex = inner.name === 'a:srgbClr' ? inner.attrs.val : inner.attrs.lastClr;
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) byName[c.name.replace(/^a:/, '')] = hex.toUpperCase();
  }
  return themeSlots(byName);
}

function readDefaultFont(bytes: Uint8Array | null): WorkbookFacts['defaultFont'] {
  if (!bytes) return {};
  const root = parseXml(bytes);
  const font = first(first(root, 'fonts'), 'font');
  const out: WorkbookFacts['defaultFont'] = {};
  const name = first(font, 'name')?.attrs.val;
  const size = Number(first(font, 'sz')?.attrs.val);
  if (name) out.name = name;
  if (Number.isFinite(size) && size > 0) out.size = size;
  return out;
}

/** Counts of what a package carries that is not read, from its directory. */
function inventory(names: readonly string[], warnings: Warnings): void {
  const count = (re: RegExp) => names.filter((n) => re.test(n)).length;
  const charts = count(/^xl\/charts\/chart[^/]*\.xml$/);
  if (charts) warnings.add('charts', (n) => `${plural(n, 'chart')} ${n === 1 ? 'was' : 'were'} left out.`, charts);
  const pictures = count(/^xl\/media\//);
  if (pictures) warnings.add('pictures', (n) => `${plural(n, 'picture')} ${n === 1 ? 'was' : 'were'} left out.`, pictures);
  const pivots = count(/^xl\/pivotTables\/pivotTable\d+\.xml$/);
  if (pivots) warnings.add('pivots', (n) => `${plural(n, 'pivot table')} ${n === 1 ? 'was' : 'were'} kept as values.`, pivots);
  if (count(/^xl\/(?:comments[^/]*\.xml|comments\/[^/]+\.xml|threadedComments\/[^/]+\.xml)$/)) warnings.add('notes', () => 'Comments and notes were left out.');
  if (count(/^xl\/vbaProject\.bin$/)) warnings.add('macros', () => 'Macros were left out.');
  if (count(/^xl\/externalLinks\//)) warnings.add('external', () => 'Links to other workbooks were left out.');
  const slicers = count(/^xl\/slicers\//) + count(/^xl\/timelines\//);
  if (slicers) warnings.add('slicers', (n) => `${plural(n, 'slicer')} ${n === 1 ? 'was' : 'were'} left out.`, slicers);
}

export function openXlsx(bytes: Uint8Array): OpenedXlsx {
  if (bytes.length > MAX_FILE_BYTES) throw new FormatError('too_large', `${bytes.length} bytes`);
  if (bytes.length >= 4 && OLE.every((b, i) => bytes[i] === b)) throw new FormatError('unsupported', 'a compound file: a password-protected workbook or an .xls');

  let zip;
  try {
    zip = openZip(bytes, (name) => READ.test(name));
  } catch (e) {
    // The shared reader says "not a Word document"; this one is not a spreadsheet.
    if (e instanceof FormatError && e.code === 'not_docx') throw new FormatError('not_xlsx', e.detail);
    throw e;
  }
  const part = (name: string) => zip.read(name);
  const workbookBytes = part('xl/workbook.xml');
  if (!workbookBytes) throw new FormatError('not_xlsx', 'no xl/workbook.xml');

  // Every part is checked before any is parsed. The sheets are checked again by their own scan, which
  // is the big text, so they are left to it; the rest are small, or ExcelJS's alone (shared strings).
  for (const name of zip.names) {
    if (!READ.test(name) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const data = part(name);
    if (data && DOCTYPE.test(decodeXml(data))) throw new FormatError('xml_unsafe', `DOCTYPE or ENTITY in ${name}`);
  }

  const warnings = new Warnings();
  inventory(zip.names, warnings);

  const rels = relationships(part('xl/_rels/workbook.xml.rels'));
  const wb = readWorkbook(workbookBytes, rels);
  const themeName = zip.names.includes('xl/theme/theme1.xml') ? 'xl/theme/theme1.xml' : zip.names.find((n) => /^xl\/theme\/[^/]+\.xml$/.test(n));
  const theme = readTheme(themeName ? part(themeName) : null);
  const book: WorkbookFacts = { ...wb, theme, defaultFont: readDefaultFont(part('xl/styles.xml')) };

  const sheets = new Map<string, SheetFacts>();
  const files: Record<string, Uint8Array> = {};
  let rawCells = 0;
  let rawRows = 0;
  const encoder = new TextEncoder();
  for (const s of book.sheets) {
    if (!s.part) continue;
    const data = part(s.part);
    if (!data) continue;
    const scanned = scanSheet(decodeXml(data));
    rawCells += scanned.facts.cells;
    rawRows += scanned.facts.rows;
    if (rawCells > MAX_RAW_CELLS || rawRows > MAX_RAW_CELLS) throw new FormatError('sheet_too_large', `${rawCells} cells in ${rawRows} rows`);
    sheets.set(s.name, scanned.facts);
    files[s.part] = encoder.encode(scanned.text);
  }
  // Not a worksheet: a chart sheet or a macro sheet. The chart on a chart sheet is counted by `inventory`; the sheet is counted here.
  const others = book.sheets.filter((s) => !s.part).length;
  if (others) warnings.add('sheet-kinds', (n) => `${plural(n, 'sheet')} that ${n === 1 ? 'is' : 'are'} not a worksheet ${n === 1 ? 'was' : 'were'} left out.`, others);

  // The workbook without its names (they are read above, and ExcelJS expands every range in one),
  // and the remaining parts as they were.
  files['xl/workbook.xml'] = encoder.encode(withoutChild(decodeXml(workbookBytes), 'definedNames'));
  for (const name of zip.names) {
    if (!READ.test(name) || name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const data = part(name);
    if (data) files[name] = data;
  }
  return { excelBytes: zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]]))), book, sheets, warnings };
}
