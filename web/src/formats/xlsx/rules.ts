/**
 * Conditional formats and data validations, from a workbook's terms into the model's.
 *
 * The model has a smaller vocabulary than Excel and says each thing one way, so a rule maps where
 * it has an exact equivalent and is left out, and counted, where it has none: icon sets are not
 * drawn here; a validation that compares against another cell is not checked here.
 * A rule written as a formula stays a formula, because the engine reads the same grammar.
 */

import type ExcelJS from 'exceljs';
import { cellAddress } from '../../sheets/engine';
import type { Rect } from '../../sheets/grid/types';
import type { CfStyle, Comparison } from '../../sheets/model/features';
import type { SeedCf, SeedCheck, SeedCondition, SeedSheetBuilder, SeedValidation } from '../../sheets/model/seed';
import { plural, type Warnings } from '../types';
import { type ExcelColor, resolveColor } from './colors';
import { fromFile } from './formula';
import { MAX_LIST_ITEMS } from './limits';
import { clamp, parseRange, parseSqref, splitSheet } from './refs';
import type { RawValidation } from './sheetxml';

export interface RuleContext {
  theme: readonly string[];
  warnings: Warnings;
}

const lost = (w: Warnings, code: string, what: string) =>
  w.add(code, (n) => `${plural(n, what)} ${n === 1 ? 'was' : 'were'} left out.`);

// ── conditional formats ─────────────────────────────────────────────────────

const OPERATORS: Record<string, Comparison> = {
  greaterThan: 'gt',
  greaterThanOrEqual: 'ge',
  lessThan: 'lt',
  lessThanOrEqual: 'le',
  equal: 'eq',
  notEqual: 'ne',
  between: 'between',
  notBetween: 'notBetween'
};

const SYMBOLS: Partial<Record<Comparison, string>> = { gt: '>', ge: '>=', lt: '<', le: '<=', eq: '=', ne: '<>' };

type Dxf = { font?: { bold?: boolean; italic?: boolean; strike?: boolean; color?: ExcelColor }; fill?: { pattern?: string; fgColor?: ExcelColor; bgColor?: ExcelColor } } | null | undefined;

/** The part of a differential format the model draws: text colour, bold, italic, strike and fill. */
function cfStyle(dxf: Dxf, theme: readonly string[]): CfStyle {
  const out: CfStyle = {};
  if (!dxf) return out;
  const f = dxf.font;
  if (f) {
    const c = resolveColor(f.color, theme);
    if (c) out.color = c;
    if (f.bold) out.bold = true;
    if (f.italic) out.italic = true;
    if (f.strike) out.strike = true;
  }
  const fill = dxf.fill;
  if (fill) {
    // A differential fill keeps its colour in `bgColor` unless the pattern says solid.
    const c = fill.pattern === 'solid' ? (resolveColor(fill.fgColor, theme) ?? resolveColor(fill.bgColor, theme)) : (resolveColor(fill.bgColor, theme) ?? resolveColor(fill.fgColor, theme));
    if (c) out.fill = c;
  }
  return out;
}

/** An operand that is a number or a quoted string stays a constant; a reference or a calculation makes the rule a formula. */
function constant(text: string): number | string | undefined {
  const t = text.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return Number(t);
  const q = /^"((?:[^"]|"")*)"$/.exec(t);
  return q ? q[1]!.replace(/""/g, '"') : undefined;
}

function cellIs(op: Comparison, operands: string[], topLeft: string): SeedCondition | null {
  const a = operands[0];
  const b = operands[1];
  if (a === undefined) return null;
  const x = constant(a);
  const y = b === undefined ? undefined : constant(b);
  if (x !== undefined && (op !== 'between' && op !== 'notBetween' ? true : y !== undefined)) {
    return y === undefined ? { kind: 'cell', op, a: x } : { kind: 'cell', op, a: x, b: y };
  }
  // A comparison against a cell or a calculation, as the formula it is.
  const e = (s: string) => fromFile(s);
  if (op === 'between') return b === undefined ? null : { kind: 'formula', formula: `AND(${topLeft}>=${e(a)},${topLeft}<=${e(b)})` };
  if (op === 'notBetween') return b === undefined ? null : { kind: 'formula', formula: `OR(${topLeft}<${e(a)},${topLeft}>${e(b)})` };
  return { kind: 'formula', formula: `${topLeft}${SYMBOLS[op]}${e(a)}` };
}

/** `"text"` inside the formulas Excel writes for the text rules, with its quotes undoubled. */
const TEXT = '"((?:[^"]|"")*)"';
const unquote = (s: string) => s.replace(/""/g, '"');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A cell reference with or without its dollar signs, as a pattern: `B2` is `$B$2` too. */
const cellRe = (a1: string): string => {
  const m = /^([A-Z]+)(\d+)$/.exec(a1);
  return m ? `\\$?${m[1]}\\$?${m[2]}` : escapeRe(a1);
};

/**
 * A rule written as a formula that is one of the rules Excel's own menu writes as one (Text that contains,
 * Blanks, Errors, Duplicate values), said as the rule it is. The model's rules are the ones the menu has, and
 * a file made by Excel or by this exporter says them as formulas.
 */
function recognised(formula: string, topLeft: string, block: string): SeedCondition | null {
  const f = fromFile(formula);
  const x = cellRe(topLeft);
  const text = (re: string, op: 'contains' | 'notContains' | 'begins' | 'ends', at = 1): SeedCondition | null => {
    const m = new RegExp(`^${re}$`).exec(f);
    return m ? { kind: 'text', op, text: unquote(m[at]!) } : null;
  };
  return (
    text(`NOT\\(ISERROR\\(SEARCH\\(${TEXT},${x}\\)\\)\\)`, 'contains') ??
    text(`ISERROR\\(SEARCH\\(${TEXT},${x}\\)\\)`, 'notContains') ??
    text(`LEFT\\(${x},LEN\\(${TEXT}\\)\\)=${TEXT}`, 'begins') ??
    text(`RIGHT\\(${x},LEN\\(${TEXT}\\)\\)=${TEXT}`, 'ends') ??
    (new RegExp(`^LEN\\(TRIM\\(${x}\\)\\)=0$`).test(f) ? { kind: 'blank' } : null) ??
    (new RegExp(`^LEN\\(TRIM\\(${x}\\)\\)>0$`).test(f) ? { kind: 'notBlank' } : null) ??
    (new RegExp(`^NOT\\(ISERROR\\(${x}\\)\\)$`).test(f) ? { kind: 'notError' } : null) ??
    (new RegExp(`^ISERROR\\(${x}\\)$`).test(f) ? { kind: 'error' } : null) ??
    (() => {
      const m = new RegExp(`^COUNTIF\\(([^,]+),${x}\\)(>1|=1)$`).exec(f);
      return m && m[1]!.replace(/\$/g, '') === block.replace(/\$/g, '') ? { kind: m[2] === '>1' ? 'duplicate' : 'unique' } : null;
    })()
  );
}

/** The text rules by the type the file gives them; the formula Excel wrote for one is what carries the text. */
function textRule(type: string, formula: string | undefined, topLeft: string): SeedCondition | null {
  if (!formula) return null;
  const rule = recognised(formula, topLeft, '');
  const wanted = { containsText: 'contains', notContainsText: 'notContains', beginsWith: 'begins', endsWith: 'ends' }[type];
  if (rule && rule.kind === 'text' && rule.op === wanted) return rule;
  return { kind: 'formula', formula: fromFile(formula) };
}

type ExcelRule = ExcelJS.ConditionalFormattingRule & {
  operator?: string;
  formulae?: (string | number)[];
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  aboveAverage?: boolean;
  cfvo?: { type: string; value?: number | string }[];
  color?: ExcelColor[] | ExcelColor;
  style?: Dxf;
  priority?: number;
};

function bar(rule: ExcelRule, theme: readonly string[]): SeedCondition | null {
  const color = Array.isArray(rule.color) ? undefined : resolveColor(rule.color, theme);
  return color ? { kind: 'bar', color } : null;
}

function scale(rule: ExcelRule, theme: readonly string[]): SeedCondition | null {
  const colors = (Array.isArray(rule.color) ? rule.color : []).map((c) => resolveColor(c, theme));
  if (colors.length < 2 || colors.some((c) => !c)) return null;
  if (colors.length === 2) return { kind: 'scale', min: colors[0]!, max: colors[1]! };
  return { kind: 'scale', min: colors[0]!, mid: colors[1]!, max: colors[2]! };
}

/** Whether a colour scale's stops are the lowest, the middle (50th percentile) and the highest, which is all the model has. */
function plainScale(rule: ExcelRule): boolean {
  const types = (rule.cfvo ?? []).map((c) => (c.type === 'percentile' && Number(c.value) === 50 ? 'mid' : c.type));
  return types.join() === 'min,max' || types.join() === 'min,mid,max';
}

const blockOf = (r: Rect): string => `${cellAddress(r.r1, r.c1)}:${cellAddress(r.r2, r.c2)}`;

export function mapConditionalFormats(
  ws: ExcelJS.Worksheet,
  ctx: RuleContext,
  rows: number,
  cols: number,
  add: (rule: SeedCf) => void,
  cap: number
): void {
  let kept = 0;
  const blocks = (ws as unknown as { conditionalFormattings?: { ref: string; rules: ExcelRule[] }[] }).conditionalFormattings ?? [];
  for (const block of blocks) {
    const ranges = parseSqref(block.ref, rows, cols);
    if (!ranges.length) continue;
    const top: Rect = ranges[0]!;
    const topLeft = cellAddress(top.r1, top.c1);
    for (const raw of block.rules) {
      const type = raw.type as string;
      let when: SeedCondition | null = null;
      const first = raw.formulae?.[0] === undefined ? undefined : String(raw.formulae[0]);
      switch (type) {
        case 'cellIs': {
          const op = OPERATORS[raw.operator ?? ''];
          when = op ? cellIs(op, (raw.formulae ?? []).map(String), topLeft) : null;
          break;
        }
        case 'containsText':
          if (raw.operator === 'containsBlanks') when = { kind: 'blank' };
          else if (raw.operator === 'notContainsBlanks') when = { kind: 'notBlank' };
          else if (raw.operator === 'containsErrors') when = { kind: 'error' };
          else if (raw.operator === 'notContainsErrors') when = { kind: 'notError' };
          else when = textRule('containsText', first, topLeft);
          break;
        case 'notContainsText':
        case 'beginsWith':
        case 'endsWith':
          when = textRule(type, first, topLeft);
          break;
        case 'duplicateValues':
          when = { kind: 'duplicate' };
          break;
        case 'uniqueValues':
          when = { kind: 'unique' };
          break;
        case 'top10':
          when = { kind: 'top', n: raw.rank ?? 10, ...(raw.percent ? { percent: true } : {}), ...(raw.bottom ? { bottom: true } : {}) };
          break;
        case 'aboveAverage':
          when = raw.aboveAverage === false ? { kind: 'average', below: true } : { kind: 'average' };
          break;
        case 'expression':
          when = first ? (recognised(first, topLeft, blockOf(top)) ?? { kind: 'formula', formula: fromFile(first) }) : null;
          break;
        case 'timePeriod':
          when = first ? { kind: 'formula', formula: fromFile(first) } : null;
          break;
        case 'colorScale':
          when = scale(raw, ctx.theme);
          if (when && !plainScale(raw)) ctx.warnings.add('cf-scale', () => 'Colour scales with set values were kept as a scale from the lowest value to the highest.');
          break;
        case 'dataBar':
          when = bar(raw, ctx.theme);
          break;
        case 'iconSet':
          ctx.warnings.add('cf-icons', (n) => `${plural(n, 'conditional format')} drawn as icons ${n === 1 ? 'was' : 'were'} left out.`);
          continue;
        default:
          break;
      }
      if (!when) {
        lost(ctx.warnings, 'cf', 'conditional format');
        continue;
      }
      if (kept >= cap) {
        ctx.warnings.add('cf-cap', () => `Conditional formats past the first ${cap} on a sheet were left out.`);
        continue;
      }
      kept++;
      add({
        ranges,
        when,
        style: cfStyle(raw.style, ctx.theme),
        priority: raw.priority ?? kept
      });
    }
  }
}

// ── validations ─────────────────────────────────────────────────────────────

const NUMERIC_TYPES: Record<string, 'number' | 'integer' | 'date' | 'textLength'> = {
  decimal: 'number',
  whole: 'integer',
  date: 'date',
  time: 'number',
  textLength: 'textLength'
};

const VALIDATION_OPERATORS: Record<string, Comparison> = { ...OPERATORS, lessThanOrEqual: 'le', greaterThanOrEqual: 'ge' };

export interface ValidationContext {
  warnings: Warnings;
  /** Sheets by name, and the size each ended up. */
  sheets: Map<string, { builder: SeedSheetBuilder; rows: number; cols: number }>;
  /** Workbook-wide names by upper-cased name: what a list may be called instead of spelling its range. */
  names: Map<string, string>;
}

function listItems(text: string): string[] | null {
  const q = /^"((?:[^"]|"")*)"$/.exec(text);
  if (!q) return null;
  return q[1]!.replace(/""/g, '"').split(',').map((s) => s.trim()).filter((s) => s !== '').slice(0, MAX_LIST_ITEMS);
}

function listRange(text: string, host: string, ctx: ValidationContext, depth = 0): SeedCheck | null {
  const { sheet, range } = splitSheet(text);
  const target = ctx.sheets.get(sheet ?? host);
  const rect = parseRange(range);
  if (target && rect) {
    const clipped = clamp(rect, target.rows, target.cols);
    return clipped ? { kind: 'listRange', sheet: target.builder, range: clipped } : null;
  }
  // A name that is itself a range.
  const named = ctx.names.get(text.trim().toUpperCase());
  return named && depth === 0 ? listRange(named, host, ctx, 1) : null;
}

/** One validation as the model has it; null when the model cannot say it. Rules about nothing (`any`) are not rules. */
export function mapValidation(v: RawValidation, hostSheet: string, rows: number, cols: number, ctx: ValidationContext): SeedValidation | null {
  if (v.type === 'any') return null;
  const ranges = parseSqref(v.sqref, rows, cols);
  if (!ranges.length) return null;
  const f1 = fromFile(v.formula1).trim();
  const f2 = fromFile(v.formula2).trim();
  let check: SeedCheck | null = null;
  if (v.type === 'list') {
    const items = listItems(f1);
    check = items ? { kind: 'list', items } : listRange(f1, hostSheet, ctx);
  } else if (v.type === 'custom') {
    check = f1 ? { kind: 'formula', formula: f1 } : null;
  } else if (NUMERIC_TYPES[v.type]) {
    const op = VALIDATION_OPERATORS[v.operator];
    const a = Number(f1);
    const b = f2 === '' ? undefined : Number(f2);
    const between = v.operator === 'between' || v.operator === 'notBetween';
    if (op && f1 !== '' && Number.isFinite(a) && (!between || (b !== undefined && Number.isFinite(b)))) {
      check = between ? { kind: NUMERIC_TYPES[v.type]!, op, a, b: b! } : { kind: NUMERIC_TYPES[v.type]!, op, a };
    }
  }
  if (!check) {
    lost(ctx.warnings, 'validation', 'data validation');
    return null;
  }
  const strict = v.showError && v.errorStyle === 'stop';
  const rule: SeedValidation = { ranges, check };
  if (strict) rule.strict = true;
  if (!v.allowBlank) rule.allowBlank = false;
  if (v.error.trim()) rule.message = v.error.trim().slice(0, 255);
  return rule;
}
