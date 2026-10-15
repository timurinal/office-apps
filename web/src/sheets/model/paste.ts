/**
 * The clipboard, read and written without a DOM, so a test runs it in Node and nothing here can
 * run a script or load an image from pasted HTML: it is tokenised by hand and only a table's
 * cells, their text and a short list of style properties are ever read.
 *
 * Three things arrive as a paste, best first:
 *
 *   · our own copy: the HTML carries the stored cells and their formats in one attribute
 *     (`data-oa-clip`), so formulas paste as formulas and move like a copy;
 *   · a table from Excel or Google Sheets, with their formats: Excel's class rules from the
 *     `<style>` block and `mso-number-format`, Google's `data-sheets-value` (the exact value),
 *     `data-sheets-numberformat` and `data-sheets-formula` (R1C1, so it lands right anywhere);
 *   · tab-separated text, quoted as Excel quotes it, each cell read as if it were typed.
 *
 * What the source app draws by default (its font, its size, black ink, bottom alignment, a
 * table's gridlines from a `td {}` rule) is not a format and is dropped, so a pasted cell looks
 * like a typed one wherever the source did not ask for something.
 */

import { colToLetters } from '../engine';
import type { BorderLine, BorderSide, CellStyle } from '../grid/types';
import type { StoredCell } from '@shared/cells';
import type { StoredStyle } from './styles';

export interface PastedCell {
  /** What a person would have typed for it; read through the engine's input. */
  text: string;
  /** The exact value, when the source said what it was. */
  value?: number | string | boolean;
  /** Google's formula, in R1C1, relative to the cell it lands in. */
  r1c1?: string;
  style?: StoredStyle;
  rowSpan?: number;
  colSpan?: number;
}

/** Our own copy: stored cells, formulas in the stored form, and the formats themselves (not ids). */
export interface OwnClip {
  /** Which workbook it came from: formulas paste as formulas only into the same one. */
  doc: string;
  sheet: string;
  r1: number;
  c1: number;
  cells: ({ c?: Omit<StoredCell, 's'>; st?: StoredStyle } | null)[][];
}

/** A paste: our own copy when there is one, and always the table, for when ours does not apply here. */
export interface Pasted {
  own: OwnClip | null;
  rows: (PastedCell | null)[][];
  /** The table came with formats, so they replace the target's. */
  styled: boolean;
}

// ── entities and tags ───────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attributes(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.set(m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function declarations(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of src.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k) out.set(k, v);
  }
  return out;
}

/** Class rules from the `<style>` blocks; rules on element names (Excel's `td {}`) are the app's defaults and are skipped. */
function classRules(html: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const blocks = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  for (const block of blocks) {
    const css = block.replace(/^<style[^>]*>|<\/style>$/gi, '').replace(/<!--|-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^}]*)\}/g;
    for (let m = re.exec(css); m; m = re.exec(css)) {
      const decls = declarations(m[2]!);
      for (const sel of m[1]!.split(',')) {
        const cls = /^\s*(?:td|th)?\.([\w-]+)\s*$/i.exec(sel)?.[1];
        if (!cls) continue;
        const prev = out.get(cls) ?? new Map<string, string>();
        for (const [k, v] of decls) prev.set(k, v);
        out.set(cls, prev);
      }
    }
  }
  return out;
}

/** A CSS string value with its escapes undone, as Excel writes `mso-number-format`. */
function cssString(v: string): string {
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_m, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch ?? '')
  );
}

const NAMED_FORMATS: Record<string, string> = {
  general: '',
  percent: '0.00%',
  standard: '#,##0.00',
  fixed: '0.00',
  scientific: '0.00E+00',
  'short date': 'dd/mm/yyyy',
  'medium date': 'dd-mmm-yy',
  'long date': 'dddd, d mmmm yyyy',
  'short time': 'hh:mm',
  'medium time': 'hh:mm AM/PM',
  'long time': 'hh:mm:ss'
};

function numberFormat(raw: string): string | undefined {
  const s = cssString(raw);
  const named = NAMED_FORMATS[s.toLowerCase()];
  if (named !== undefined) return named || undefined;
  return s || undefined;
}

const DEFAULT_INK = /^(black|windowtext|auto|#000|#000000|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|initial|inherit)$/i;
const NO_FILL = /^(none|transparent|auto|initial|inherit|white|#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;
const DEFAULT_FONTS = /^(calibri|aptos|aptos narrow|arial|inter|helvetica|sans-serif|system-ui)$/i;
const COLOR = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b[a-z]+\b)/i;

function cssColor(v: string): string | undefined {
  const t = v.trim().replace(/\s*!important$/i, '');
  if (!t || DEFAULT_INK.test(t)) return undefined;
  return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(t) ? t : undefined;
}

function points(v: string): number | undefined {
  const m = /^([\d.]+)\s*(pt|px)?$/i.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return m[2]?.toLowerCase() === 'px' ? Math.round(n * 0.75 * 2) / 2 : n;
}

function border(v: string): BorderSide | null | undefined {
  const t = v.trim().toLowerCase();
  if (!t || /^(none|hidden|0)\b/.test(t) || /\b(none|hidden)\b/.test(t)) return null;
  const style = /\b(solid|dashed|dotted|double)\b/.exec(t)?.[1] ?? 'solid';
  const wm = /(?:^|\s)(thin|medium|thick|[\d.]+(?:pt|px)?)(?=\s|$)/.exec(t)?.[1];
  let width = 1;
  if (wm === 'medium') width = 2;
  else if (wm === 'thick') width = 3;
  else if (wm && wm !== 'thin') {
    const n = parseFloat(wm);
    width = wm.endsWith('pt') ? n / 0.75 : n;
  }
  if (width <= 0) return null;
  let line: BorderLine = style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : style === 'double' ? 'double' : 'thin';
  if (line === 'thin') line = width >= 2.5 ? 'thick' : width >= 1.5 ? 'medium' : 'thin';
  const rest = t.replace(/\b(solid|dashed|dotted|double|thin|medium|thick)\b|[\d.]+(pt|px)?/g, ' ').trim();
  const color = rest ? cssColor(COLOR.exec(rest)?.[1] ?? '') : undefined;
  return color ? { line, color } : { line };
}

type Source = 'excel' | 'google' | 'other';

/** The format a cell's CSS asks for, without what the source app draws by default. */
function styleFrom(decls: Map<string, string>, source: Source): StoredStyle {
  const s: Record<string, unknown> = {};
  const w = decls.get('font-weight');
  if (w && /^(bold|bolder|[6-9]00)$/i.test(w)) s.bold = true;
  if (/^(italic|oblique)/i.test(decls.get('font-style') ?? '')) s.italic = true;
  const deco = `${decls.get('text-decoration') ?? ''} ${decls.get('text-decoration-line') ?? ''}`.toLowerCase();
  if (deco.includes('underline')) s.underline = true;
  if (deco.includes('line-through')) s.strike = true;
  const color = decls.get('color');
  if (color) {
    const c = cssColor(color);
    if (c) s.color = c;
  }
  const bg = decls.get('background-color') ?? decls.get('background');
  if (bg) {
    const t = bg.trim();
    const c = NO_FILL.test(t) ? undefined : (COLOR.exec(t)?.[1] ?? undefined);
    if (c && !NO_FILL.test(c)) s.fill = c;
  }
  const size = decls.get('font-size');
  if (size) {
    const pt = points(size);
    // Each app's own default size is not a format: Excel's 11, Google's 10, ours 10.
    if (pt && !(pt === 10 || (source === 'excel' && pt === 11))) s.size = pt;
  }
  const family = decls.get('font-family');
  if (family) {
    const first = family.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    if (first && !DEFAULT_FONTS.test(first)) s.font = first;
  }
  const align = decls.get('text-align')?.toLowerCase();
  if (align === 'left' || align === 'center' || align === 'right') s.h = align;
  else if (align === 'centre') s.h = 'center';
  const valign = decls.get('vertical-align')?.toLowerCase();
  if (valign === 'top') s.v = 'top';
  else if (valign === 'middle') s.v = 'middle';
  if (/^(normal|pre-wrap|break-spaces)$/i.test(decls.get('white-space') ?? '') && source !== 'google') s.wrap = true;
  if (source === 'google' && /^(normal|pre-wrap)$/i.test(decls.get('white-space') ?? '') && decls.has('word-wrap')) s.wrap = true;
  const indent = decls.get('mso-char-indent-count');
  if (indent && Number(indent) > 0) s.indent = Math.min(15, Math.round(Number(indent)));
  const fmt = decls.get('mso-number-format');
  if (fmt) {
    const f = numberFormat(fmt);
    if (f) s.numFmt = f;
  }
  const all = decls.get('border');
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  for (const side of sides) {
    const v = decls.get(`border-${side}`) ?? all;
    if (v === undefined) continue;
    const b = border(v);
    if (b) s[`border${side[0]!.toUpperCase()}${side.slice(1)}`] = b;
  }
  return s as StoredStyle;
}

// ── tables ──────────────────────────────────────────────────────────────────

const CLIP_ATTR = 'data-oa-clip';

function readOwn(html: string): OwnClip | null {
  const m = new RegExp(`${CLIP_ATTR}\\s*=\\s*"([^"]*)"`, 'i').exec(html);
  if (!m) return null;
  try {
    const v = JSON.parse(decodeEntities(m[1]!)) as OwnClip;
    if (typeof v !== 'object' || !v || !Array.isArray(v.cells) || typeof v.sheet !== 'string' || typeof v.doc !== 'string') return null;
    if (!v.cells.every((r) => Array.isArray(r))) return null;
    if (!Number.isInteger(v.r1) || !Number.isInteger(v.c1)) return null;
    return v;
  } catch {
    return null;
  }
}

interface GoogleValue {
  '1'?: number;
  '2'?: string;
  '3'?: number;
  '4'?: number | boolean;
}

function googleValue(raw: string | undefined): number | string | boolean | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as GoogleValue;
    if (v['1'] === 2 && typeof v['2'] === 'string') return v['2'];
    if (v['1'] === 3 && typeof v['3'] === 'number' && Number.isFinite(v['3'])) return v['3'];
    if (v['1'] === 4 && v['4'] !== undefined) return v['4'] === true || v['4'] === 1;
  } catch {
    // An attribute we cannot read is the same as none: the cell's text stands.
  }
  return undefined;
}

function googleFormat(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return typeof v['2'] === 'string' && v['2'] ? v['2'] : undefined;
  } catch {
    return undefined;
  }
}

/** The cells of the first table in a clipboard's HTML, placed as a browser would, spans included. */
function readTable(html: string): { rows: (PastedCell | null)[][]; styled: boolean } | null {
  const start = html.search(/<table[\s>]/i);
  if (start < 0) return null;
  const source: Source = /urn:schemas-microsoft-com:office:excel|ProgId\s*=?\s*["']?Excel/i.test(html)
    ? 'excel'
    : /google-sheets-html-origin|data-sheets-/i.test(html)
      ? 'google'
      : 'other';
  const rules = classRules(html);
  const body = html.slice(start).replace(/<!--[\s\S]*?-->/g, '');
  const grid: (PastedCell | null)[][] = [];
  const taken = new Set<string>();
  let row = -1;
  let depth = 0;
  let cell: { attrs: Map<string, string>; text: string; tags: Set<string> } | null = null;
  let styled = false;

  const finish = () => {
    if (!cell || row < 0) return;
    const a = cell.attrs;
    let col = 0;
    while (taken.has(`${row}:${col}`)) col++;
    const rowSpan = Math.max(1, Math.min(1000, parseInt(a.get('rowspan') ?? '1', 10) || 1));
    const colSpan = Math.max(1, Math.min(1000, parseInt(a.get('colspan') ?? '1', 10) || 1));
    for (let r = 0; r < rowSpan; r++) for (let c = 0; c < colSpan; c++) taken.add(`${row + r}:${col + c}`);
    const decls = new Map<string, string>();
    for (const cls of (a.get('class') ?? '').split(/\s+/)) for (const [k, v] of rules.get(cls) ?? []) decls.set(k, v);
    for (const [k, v] of declarations(a.get('style') ?? '')) decls.set(k, v);
    // Excel's `align` attribute is its General alignment worked out (numbers right), not a format.
    const align = source === 'excel' ? undefined : a.get('align')?.toLowerCase();
    if (align && !decls.has('text-align')) decls.set('text-align', align);
    const valign = a.get('valign')?.toLowerCase();
    if (valign && !decls.has('vertical-align')) decls.set('vertical-align', valign);
    const style = styleFrom(decls, source);
    if (cell.tags.has('b')) style.bold = true;
    if (cell.tags.has('i')) style.italic = true;
    if (cell.tags.has('u')) style.underline = true;
    if (cell.tags.has('s')) style.strike = true;
    const gf = googleFormat(a.get('data-sheets-numberformat'));
    if (gf) style.numFmt = gf;
    const text = cell.text
      .replace(/[ \t\r\n]+/g, ' ')
      .replace(/ ?\u0001 ?/g, '\n')
      .replace(/ /g, ' ')
      .trim();
    const out: PastedCell = { text };
    const gv = googleValue(a.get('data-sheets-value'));
    if (gv !== undefined) out.value = gv;
    else if (a.has('x:num')) {
      const n = Number(a.get('x:num') || text.replace(/[^\d.eE+-]/g, ''));
      if (Number.isFinite(n) && (a.get('x:num') || text)) out.value = n;
    } else if (a.has('x:bool')) out.value = /^true$/i.test(a.get('x:bool') || text);
    const formula = a.get('data-sheets-formula');
    if (formula && formula.startsWith('=')) out.r1c1 = formula;
    if (Object.keys(style).length) {
      out.style = style;
      styled = true;
    }
    if (rowSpan > 1) out.rowSpan = rowSpan;
    if (colSpan > 1) out.colSpan = colSpan;
    while (grid.length <= row) grid.push([]);
    const line = grid[row]!;
    while (line.length < col) line.push(null);
    line[col] = out;
    cell = null;
  };

  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[4] !== undefined) {
      if (cell) cell.text += decodeEntities(m[4]);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (tag === 'table') {
      depth += closing ? -1 : 1;
      if (closing && depth <= 0) break;
      continue;
    }
    // A table inside a cell is read as that cell's text.
    if (depth > 1) continue;
    if (tag === 'tr') {
      if (!closing) {
        finish();
        row++;
      } else finish();
    } else if (tag === 'td' || tag === 'th') {
      finish();
      if (!closing) {
        if (row < 0) row = 0;
        cell = { attrs: attributes(m[3] ?? ''), text: '', tags: new Set() };
      }
    } else if (cell && !closing) {
      if (tag === 'br') cell.text += '\u0001';
      else if (tag === 'b' || tag === 'strong') cell.tags.add('b');
      else if (tag === 'i' || tag === 'em') cell.tags.add('i');
      else if (tag === 'u') cell.tags.add('u');
      else if (tag === 's' || tag === 'strike' || tag === 'del') cell.tags.add('s');
      else if (tag === 'font') {
        const c = attributes(m[3] ?? '').get('color');
        const ink = c ? cssColor(c) : undefined;
        if (ink) cell.attrs.set('style', `${cell.attrs.get('style') ?? ''};color:${ink}`);
      }
    } else if (cell && closing && (tag === 'p' || tag === 'div')) cell.text += '\u0001';
  }
  finish();
  if (!grid.length) return null;
  return { rows: grid, styled };
}

/** Tab-separated text as Excel writes it: a field with a tab, a newline or a quote is quoted, and quotes doubled. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const t = text.replace(/\r\n?/g, '\n');
  for (;;) {
    let field = '';
    if (t[i] === '"') {
      // Only a quote that closes before a tab, a newline or the end makes a quoted field.
      let j = i + 1;
      let s = '';
      let closed = false;
      while (j < t.length) {
        if (t[j] === '"') {
          if (t[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          closed = j + 1 >= t.length || t[j + 1] === '\t' || t[j + 1] === '\n';
          break;
        }
        s += t[j++];
      }
      if (closed) {
        field = s;
        i = j + 1;
      }
    }
    if (i < t.length && t[i] !== '\t' && t[i] !== '\n') {
      const end = t.slice(i).search(/[\t\n]/);
      field += end < 0 ? t.slice(i) : t.slice(i, i + end);
      i = end < 0 ? t.length : i + end;
    }
    row.push(field);
    if (i >= t.length) break;
    if (t[i] === '\n') {
      rows.push(row);
      row = [];
      if (i + 1 >= t.length) return rows;
    }
    i++;
  }
  rows.push(row);
  return rows;
}

/** What a paste holds: our own copy if it is one, and the table from the HTML, or from the text without HTML. */
export function readClipboard(text: string, html?: string): Pasted {
  if (html) {
    const table = readTable(html);
    if (table) return { own: readOwn(html), ...table };
  }
  const rows = parseTsv(text).map((r) => r.map((t): PastedCell | null => (t === '' ? null : { text: t })));
  return { own: null, rows, styled: false };
}

// ── R1C1 ────────────────────────────────────────────────────────────────────

/**
 * A Google formula's R1C1 references as A1, for the cell at (row, col). Null when a reference
 * lands outside the sheet or is a form this does not read (whole rows or columns), so the
 * caller pastes the value instead of a wrong formula.
 */
export function r1c1ToA1(formula: string, row: number, col: number): string | null {
  let out = '';
  let ok = true;
  const part = (abs: string | undefined, rel: string | undefined, base: number): { n: number; abs: boolean } => {
    if (abs !== undefined) return { n: parseInt(abs, 10) - 1, abs: true };
    return { n: base + (rel !== undefined ? parseInt(rel, 10) : 0), abs: false };
  };
  const re = /("(?:[^"]|"")*")|(?<![\w.$\\])R(?:\[(-?\d+)\]|(\d+))?C(?:\[(-?\d+)\]|(\d+))?(?![\w.(])/g;
  let last = 0;
  for (let m = re.exec(formula); m; m = re.exec(formula)) {
    out += formula.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      out += m[1];
      continue;
    }
    const r = part(m[3], m[2], row);
    const c = part(m[5], m[4], col);
    if (r.n < 0 || c.n < 0) {
      ok = false;
      break;
    }
    out += `${c.abs ? '$' : ''}${colToLetters(c.n)}${r.abs ? '$' : ''}${r.n + 1}`;
  }
  out += formula.slice(last);
  if (!ok) return null;
  const outside = out.replace(/"(?:[^"]|"")*"/g, '');
  if (/(?<![\w.$\\])[RC]\[-?\d+\]/.test(outside)) return null;
  return out;
}

// ── writing ─────────────────────────────────────────────────────────────────

/** Text for the clipboard's plain flavour: tabs between cells, quoted where Excel quotes. */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map((t) => (/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)).join('\t')).join('\n');
}

/** A format as inline CSS, for Excel, Google Sheets and anything else that reads an HTML table. */
export function styleCss(s: CellStyle): string {
  const out: string[] = [];
  if (s.bold) out.push('font-weight:bold');
  if (s.italic) out.push('font-style:italic');
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) out.push(`text-decoration:${deco}`);
  if (s.color) out.push(`color:${s.color}`);
  if (s.fill) out.push(`background-color:${s.fill}`);
  if (s.font) out.push(`font-family:${s.font.includes(' ') ? `'${s.font.replace(/'/g, '')}'` : s.font}`);
  if (s.size) out.push(`font-size:${s.size}pt`);
  if (s.h && s.h !== 'general') out.push(`text-align:${s.h}`);
  if (s.v) out.push(`vertical-align:${s.v}`);
  if (s.wrap) out.push('white-space:normal;word-wrap:break-word');
  if (s.numFmt) out.push(`mso-number-format:"${s.numFmt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const widths: Record<BorderLine, string> = { thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double' };
  for (const [k, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const b = s[k];
    if (b) out.push(`border-${side}:${widths[b.line]} ${b.color ?? '#000000'}`);
  }
  return out.join(';');
}

export interface ClipCellOut {
  text: string;
  style: CellStyle;
  /** The exact number, for Google Sheets. */
  number?: number;
}

/** The clipboard's HTML flavour: a table any spreadsheet reads, with our own copy in one attribute. */
export function toHtml(cells: ClipCellOut[][], own: OwnClip): string {
  const rows = cells.map((r) =>
    r
      .map((c) => {
        const css = styleCss(c.style);
        const value = c.number !== undefined ? ` data-sheets-value="${escapeHtml(JSON.stringify({ 1: 3, 3: c.number }))}"` : '';
        const text = escapeHtml(c.text).replace(/\n/g, '<br>');
        return `<td${css ? ` style="${escapeHtml(css)}"` : ''}${value}>${text}</td>`;
      })
      .join('')
  );
  return (
    `<meta charset="utf-8"><table ${CLIP_ATTR}="${escapeHtml(JSON.stringify(own))}" style="border-collapse:collapse">` +
    `<tbody>${rows.map((r) => `<tr>${r}</tr>`).join('')}</tbody></table>`
  );
}
