/**
 * The Data tab: sorting, the filter, data validation, removing duplicates and splitting text into
 * columns, as plain functions over the context. Each makes one model call or one `batch`, so each is
 * one undo and one frame, and the dialogs, the ribbon and the commands all call the same thing.
 *
 * Where a command needs a block of cells and the selection is one cell, it takes the block of data
 * around it (`currentRegion`), as Excel does; a selection of several cells is the block, as written.
 */

import { parseAddress, rectAddress } from '../grid/a1';
import type { Cellpos, Rect } from '../grid/types';
import {
  type FilterCriterion,
  type IdRect,
  type ValidationCheck,
  type ValidationRule,
  resolveRect,
  toIdRect
} from '../model';
import { toTsv } from '../model/paste';
import { formatValue, parseValue, type SortKey } from '../engine';
import type { ActionContext } from './actions';
import { currentRegion, hasCell, overlaps, subtractAll } from './rects';

type Ctx = ActionContext;

const textAt = (c: Pick<Ctx, 'data'>, row: number, col: number): string => c.data.cell(row, col)?.text ?? '';

// ── the block a command works on ────────────────────────────────────────────

/** The filter's block when the active cell is in it, else the selection, or the data around one selected cell. */
export function regionFor(c: Ctx): Rect {
  const { rect, active } = c.selection();
  const inFilter = filterRect(c);
  if (inFilter && hasCell(inFilter, active.row, active.col)) return inFilter;
  if (rect.r1 !== rect.r2 || rect.c1 !== rect.c2) return rect;
  // Whether a cell holds anything is the engine's to say; drawing each cell to find out is what a long column cannot afford.
  const sheet = c.model.engine.sheet(c.sheetId);
  const filled = (r: number, k: number) => !!sheet && sheet.cell(sheet.rowOrder[r] ?? '', sheet.colOrder[k] ?? '') !== undefined;
  return currentRegion(active, c.data.rowCount(), c.data.colCount(), filled);
}

/** The filter's block at today's positions, or null when there is no filter. */
export function filterRect(c: Pick<Ctx, 'model' | 'sheetId'>): Rect | null {
  const range = c.model.filterRange(c.sheetId);
  const sheet = c.model.engine.sheet(c.sheetId);
  return range && sheet ? resolveRect(sheet, range) : null;
}

type Kind = 'empty' | 'text' | 'number' | 'boolean' | 'error';
const kindAt = (c: Pick<Ctx, 'data'>, row: number, col: number): Kind => c.data.cell(row, col)?.kind ?? 'empty';

/**
 * Whether the first row of a block is a heading. Excel's own guess: a column whose first cell is
 * text over a number says so; failing that, a first row that is all text and in bold where the
 * next one is not.
 */
export function detectHeader(c: Pick<Ctx, 'data'>, r: Rect): boolean {
  if (r.r2 <= r.r1) return false;
  let text = 0;
  let filled = 0;
  let bold = 0;
  for (let col = r.c1; col <= r.c2; col++) {
    const first = kindAt(c, r.r1, col);
    const next = kindAt(c, r.r1 + 1, col);
    if (first === 'text' && (next === 'number' || next === 'boolean')) return true;
    if (first !== 'empty') filled++;
    if (first === 'text') text++;
    if (c.data.cell(r.r1, col)?.style.bold && !c.data.cell(r.r1 + 1, col)?.style.bold) bold++;
  }
  return filled > 0 && text === filled && bold === filled;
}

// ── sort ────────────────────────────────────────────────────────────────────

export interface SortLevel {
  /** The column by position in the sheet. */
  col: number;
  descending: boolean;
}

const keysOf = (levels: readonly SortLevel[]): SortKey[] => levels.map((l) => ({ col: l.col, ...(l.descending ? { descending: true } : {}) }));

/**
 * A to Z or Z to A on the active cell's column. A filter's block is sorted under its header, a
 * block of data with a heading is sorted under it, and what is selected is sorted as it stands.
 */
export function sortBy(c: Ctx, descending: boolean): void {
  const r = regionFor(c);
  const { active } = c.selection();
  const col = active.col >= r.c1 && active.col <= r.c2 ? active.col : r.c1;
  const header = filterRect(c) ? true : detectHeader(c, r);
  c.model.sort(c.sheetId, r, [{ col, ...(descending ? { descending: true } : {}) }], { header });
}

/** Several keys over a block, the first the most important. */
export function sortCustom(c: Ctx, r: Rect, levels: readonly SortLevel[], header: boolean): void {
  if (levels.length === 0) return;
  c.model.sort(c.sheetId, r, keysOf(levels), { header });
}

// ── filter ──────────────────────────────────────────────────────────────────

export const filterOn = (c: Pick<Ctx, 'data'>): boolean => c.data.filter() !== null;

/** Whether any column of the filter has a criterion. */
export const filterActive = (c: Pick<Ctx, 'data'>): boolean => (c.data.filter()?.active.length ?? 0) > 0;

/** Puts a filter on the block of data, or takes it off with its criteria. */
export function toggleFilter(c: Ctx): void {
  if (filterOn(c)) {
    c.model.setFilter(c.sheetId, null);
    return;
  }
  const r = regionFor(c);
  if (r.r1 === r.r2 && r.c1 === r.c2) {
    c.notify({ text: 'Select cells that hold data to filter them.' });
    return;
  }
  c.model.setFilter(c.sheetId, r);
}

/** Every column's criterion off at once, as one step; the buttons stay. */
export function clearFilters(c: Ctx): void {
  const f = c.data.filter();
  if (!f || f.active.length === 0) return;
  c.model.batch(() => {
    for (const col of f.active) c.model.setFilterCriterion(c.sheetId, col, null);
  });
}

/**
 * What a column shows in a filter: the values ticked, as a criterion. `alsoHidden` are values that
 * were hidden before and are not in the list now (another column's filter has them out of sight),
 * and stay hidden. Ticking every value takes the criterion away.
 */
export function setValuesFilter(c: Ctx, col: number, ticked: ReadonlySet<string>, all: readonly string[], alsoHidden: Iterable<string> = []): void {
  const hidden = [...all.filter((v) => !ticked.has(v)), ...alsoHidden];
  c.model.setFilterCriterion(c.sheetId, col, hidden.length === 0 ? null : { kind: 'values', hidden });
}

export const setCriterion = (c: Ctx, col: number, criterion: FilterCriterion | null): void => c.model.setFilterCriterion(c.sheetId, col, criterion);

/** A filter menu's sort: the block under the header, by one column. */
export function sortFilterColumn(c: Ctx, col: number, descending: boolean): void {
  const r = filterRect(c);
  if (!r) return;
  c.model.sort(c.sheetId, r, [{ col, ...(descending ? { descending: true } : {}) }], { header: true });
}

// ── validation ──────────────────────────────────────────────────────────────

export interface RuleEntry {
  id: string;
  rule: ValidationRule;
  rects: Rect[];
}

export function validationRules(c: Pick<Ctx, 'model' | 'sheetId'>): RuleEntry[] {
  const sheet = c.model.engine.sheet(c.sheetId);
  if (!sheet) return [];
  return c.model.rules(c.sheetId, 'validation').map(({ id, rule }) => ({
    id,
    rule,
    rects: (rule.ranges ?? []).map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null)
  }));
}

/** The rule that covers a cell, the way the model finds it. */
export function validationAt(c: Pick<Ctx, 'model' | 'sheetId'>, at: Cellpos): RuleEntry | undefined {
  return validationRules(c)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .find((v) => v.rects.some((r) => hasCell(r, at.row, at.col)));
}

export interface ValidationDraft {
  check: ValidationCheck;
  /** Refuse a value that fails; otherwise it is kept and a warning is shown. */
  strict: boolean;
  allowBlank: boolean;
  message?: string;
  prompt?: { title?: string; text: string };
}

const ruleOf = (c: Ctx, rects: Rect[], d: ValidationDraft): ValidationRule | null => {
  const sheet = c.model.engine.sheet(c.sheetId);
  const ranges = rects.map((r) => (sheet ? toIdRect(sheet, r) : null)).filter((r): r is IdRect => r !== null);
  if (ranges.length === 0) return null;
  return {
    ranges,
    check: d.check,
    ...(d.strict ? { strict: true } : {}),
    ...(d.allowBlank ? {} : { allowBlank: false }),
    ...(d.message ? { message: d.message } : {}),
    ...(d.prompt && (d.prompt.text || d.prompt.title) ? { prompt: d.prompt } : {})
  };
};

/** Takes `cut` out of every rule's ranges (a rule left with none goes), inside the step that is running. */
function cutRules(c: Ctx, cut: Rect, except?: string): void {
  const sheet = c.model.engine.sheet(c.sheetId);
  if (!sheet) return;
  for (const { id, rule, rects } of validationRules(c)) {
    if (id === except || !rects.some((r) => overlaps(r, cut))) continue;
    const left = subtractAll(rects, cut)
      .map((r) => toIdRect(sheet, r))
      .filter((r): r is IdRect => r !== null);
    c.model.setRule(c.sheetId, 'validation', id, left.length ? { ...rule, ranges: left } : null);
  }
}

/**
 * A rule onto the selected cells, which stop answering to any other rule: what they were is cut out
 * of the rules that reached them, so a cell never has two. One step.
 */
export function applyValidation(c: Ctx, rects: Rect[], d: ValidationDraft): string | undefined {
  const rule = ruleOf(c, rects, d);
  if (!rule) return undefined;
  return c.model.batch(() => {
    for (const r of rects) cutRules(c, r);
    return c.model.setRule(c.sheetId, 'validation', null, rule);
  });
}

/** Changes the rule a cell is under, for all of its cells. */
export function updateValidation(c: Ctx, id: string, d: ValidationDraft): void {
  const old = validationRules(c).find((v) => v.id === id);
  const rule = old ? ruleOf(c, old.rects, d) : null;
  if (rule) c.model.setRule(c.sheetId, 'validation', id, rule);
}

/** The selected cells answer to no rule. Returns how many rules it changed. */
export function clearValidation(c: Ctx, rects: Rect[] = [c.selection().rect]): number {
  let changed = 0;
  c.model.batch(() => {
    for (const cut of rects) {
      changed += validationRules(c).filter((v) => v.rects.some((r) => overlaps(r, cut))).length;
      cutRules(c, cut);
    }
  });
  return changed;
}

/** What a person types for a list: items between commas, as they are, empty ones dropped. */
export function parseItems(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Where a list's choices come from, from what is typed: `A1:A5`, `$A$1:$A$5`, `=Costs!B2:B9`, a
 * whole column `A:A`. A sheet name before the `!` picks another sheet; without one it is this sheet.
 */
export function parseSource(c: Pick<Ctx, 'model' | 'sheetId'>, text: string): { sheet: string; rect: Rect } | null {
  const t = text.trim().replace(/^=/, '');
  const bang = t.lastIndexOf('!');
  const name = bang < 0 ? null : t.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  const sheet = name === null ? c.sheetId : c.model.sheets().find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
  const sh = sheet ? c.model.engine.sheet(sheet) : undefined;
  if (!sheet || !sh) return null;
  const rect = parseAddress(bang < 0 ? t : t.slice(bang + 1), sh.rowOrder.length, sh.colOrder.length);
  return rect ? { sheet, rect } : null;
}

/** The source as a person reads it: `Costs!$B$2:$B$9`, or just the range when it is on this sheet. */
export function showSource(c: Pick<Ctx, 'model' | 'sheetId'>, check: Extract<ValidationCheck, { kind: 'listRange' }>): string {
  const sh = c.model.engine.sheet(check.sheet);
  const r = sh ? resolveRect(sh, check.range) : null;
  if (!sh || !r) return '';
  const a1 = rectAddress(r).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
  return check.sheet === c.sheetId ? a1 : `${/^[A-Za-z0-9_]+$/.test(sh.name) ? sh.name : `'${sh.name.replace(/'/g, "''")}'`}!${a1}`;
}

/** A date typed into a rule as its serial number, or null when it is not one. */
export function parseDateInput(c: Pick<Ctx, 'model'>, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const v = parseValue(t, c.model.engine.dateOrder).content?.v;
  return typeof v === 'number' ? v : null;
}

/** A serial as the date a rule is typed with. */
export const showDate = (serial: number): string => formatValue(serial, 'dd/mm/yyyy').text;

// ── remove duplicates ───────────────────────────────────────────────────────

export interface DuplicatesResult {
  removed: number;
  unique: number;
}

/**
 * Removes the rows of `rect` that repeat an earlier row in every one of `cols`, comparing what the
 * cells show without regard to case, as Excel does. The rows that stay move up and close the gaps,
 * and what is left at the bottom of the block is cleared; its formats stay where they were. One
 * step, and none at all when there is nothing to remove.
 *
 * A row moves as the text a person would type into it, so a formula keeps its references as written
 * and does not shift with the row.
 */
export function removeDuplicates(c: Ctx, rect: Rect, cols: readonly number[], header: boolean): DuplicatesResult {
  const first = rect.r1 + (header ? 1 : 0);
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let r = first; r <= rect.r2; r++) {
    const key = cols.map((col) => textAt(c, r, col).toLowerCase()).join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(r);
  }
  const removed = rect.r2 - first + 1 - keep.length;
  if (removed === 0) return { removed: 0, unique: keep.length };
  const rows = keep.map((r) => {
    const out: string[] = [];
    for (let col = rect.c1; col <= rect.c2; col++) out.push(c.data.editText(r, col));
    return out;
  });
  c.model.batch(() => {
    c.model.paste(c.sheetId, { row: first, col: rect.c1 }, toTsv(rows));
    c.model.clear(c.sheetId, { ...rect, r1: first + keep.length });
  });
  return { removed, unique: keep.length };
}

// ── text to columns ─────────────────────────────────────────────────────────

export interface SplitOptions {
  /** Every character that separates. */
  chars: readonly string[];
  /** Several separators in a row count as one. */
  merge: boolean;
}

/**
 * One cell's text split at the separators. A field in double quotes keeps its separators, and the
 * quotes are not part of it; two quotes inside are one.
 */
export function splitText(text: string, o: SplitOptions): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let wasSeparator = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"' && cur === '') {
      quoted = true;
      wasSeparator = false;
      continue;
    }
    if (o.chars.includes(ch)) {
      if (!(o.merge && wasSeparator)) out.push(cur);
      cur = '';
      wasSeparator = true;
      continue;
    }
    wasSeparator = false;
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** The separators the dialog offers, by name. */
export const SEPARATORS: readonly { id: string; label: string; char: string }[] = [
  { id: 'comma', label: 'Comma', char: ',' },
  { id: 'semicolon', label: 'Semicolon', char: ';' },
  { id: 'tab', label: 'Tab', char: '\t' },
  { id: 'space', label: 'Space', char: ' ' }
];

/**
 * Splits each cell of one column across the columns to its right, replacing what is there, as one
 * step. Returns how many columns it filled, or 0 when nothing was split.
 */
export function textToColumns(c: Ctx, rect: Rect, o: SplitOptions): number {
  if (rect.c1 !== rect.c2 || o.chars.length === 0) return 0;
  const rows: string[][] = [];
  let width = 0;
  for (let r = rect.r1; r <= rect.r2; r++) {
    const text = c.data.editText(r, rect.c1);
    const parts = text === '' ? [''] : splitText(text, o);
    rows.push(parts);
    width = Math.max(width, parts.length);
  }
  if (width <= 1) return 0;
  for (const row of rows) while (row.length < width) row.push('');
  c.model.paste(c.sheetId, { row: rect.r1, col: rect.c1 }, toTsv(rows));
  return width;
}

/** The cells a split would overwrite beyond the first column, as an address, or null when there are none. */
export function splitTarget(c: Pick<Ctx, 'data'>, rect: Rect, width: number): string | null {
  if (width <= 1) return null;
  const to = { ...rect, c1: rect.c1 + 1, c2: rect.c1 + width - 1 };
  for (let r = to.r1; r <= to.r2; r++) for (let k = to.c1; k <= to.c2; k++) if (textAt(c, r, k) !== '') return rectAddress(to);
  return null;
}
