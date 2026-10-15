/**
 * Conditional formatting: the rules of a sheet read and written through the model, and the presets
 * the menu offers. The model stores each rule once (`CfRule`: ranges by row and column id, a priority,
 * a condition and a look) and decides at draw time what a cell shows, so nothing here computes a result.
 *
 * Priority: lower is first, and a rule above another wins the fields they both set. A new rule goes
 * on top, as in Excel. Moving a rule renumbers every rule in one step, so two people reordering at
 * once each get a whole order and never two rules with the same number.
 */

import { rectAddress } from '../grid/a1';
import type { Rect } from '../grid/types';
import { type CfCondition, type CfRule, type CfStyle, type Comparison, resolveRect, toIdRect } from '../model';
import type { ActionContext } from './actions';
import { cellCount, subtractAll } from './rects';

export interface RuleEntry {
  id: string;
  rule: CfRule;
  /** The ranges at today's positions; a range whose rows or columns are all gone is left out. */
  rects: Rect[];
}

/** The sheet's rules, first priority first. */
export function rulesOf(c: Pick<ActionContext, 'model' | 'sheetId'>): RuleEntry[] {
  const sheet = c.model.engine.sheet(c.sheetId);
  if (!sheet) return [];
  return c.model
    .rules(c.sheetId, 'cf')
    .map(({ id, rule }) => ({
      id,
      rule,
      rects: (rule.ranges ?? []).map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null)
    }))
    .sort((a, b) => a.rule.priority - b.rule.priority || (a.id < b.id ? -1 : 1));
}

const idRects = (c: Pick<ActionContext, 'model' | 'sheetId'>, rects: readonly Rect[]) => {
  const sheet = c.model.engine.sheet(c.sheetId);
  return rects.map((r) => (sheet ? toIdRect(sheet, r) : null)).filter((r): r is NonNullable<typeof r> => r !== null);
};

export interface RuleDraft {
  rects: Rect[];
  when: CfCondition;
  style: CfStyle;
  stop?: boolean;
}

const build = (c: ActionContext, d: RuleDraft, priority: number): CfRule | null => {
  const ranges = idRects(c, d.rects);
  if (ranges.length === 0) return null;
  return { ranges, priority, when: d.when, style: d.style, ...(d.stop ? { stop: true } : {}) };
};

/** A rule on top of the others. Its id, or undefined when the model refused or no range is on the sheet. */
export function addRule(c: ActionContext, d: RuleDraft): string | undefined {
  const top = rulesOf(c)[0]?.rule.priority ?? 1;
  const rule = build(c, d, top - 1);
  return rule ? c.model.setRule(c.sheetId, 'cf', null, rule) : undefined;
}

/** Replaces a rule's ranges, condition, look and stop flag, keeping its place. */
export function updateRule(c: ActionContext, id: string, d: RuleDraft): void {
  const old = c.model.rules(c.sheetId, 'cf').find((r) => r.id === id);
  if (!old) return;
  const rule = build(c, d, old.rule.priority);
  if (rule) c.model.setRule(c.sheetId, 'cf', id, rule);
}

export function removeRule(c: ActionContext, id: string): void {
  c.model.setRule(c.sheetId, 'cf', id, null);
}

/** One place up or down the list, written as a fresh numbering of the whole list in one step. */
export function moveRule(c: ActionContext, id: string, delta: -1 | 1): void {
  const list = c.model.rules(c.sheetId, 'cf').sort((a, b) => a.rule.priority - b.rule.priority || (a.id < b.id ? -1 : 1));
  const at = list.findIndex((r) => r.id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= list.length) return;
  const [moved] = list.splice(at, 1);
  list.splice(to, 0, moved!);
  c.model.batch(() => {
    list.forEach((r, i) => {
      if (r.rule.priority !== i) c.model.setRule(c.sheetId, 'cf', r.id, { ...r.rule, priority: i });
    });
  });
}

/**
 * Takes the formats away from the selected cells, or from the whole sheet. A rule that reaches past
 * the selection keeps the rest of its ranges; one that lies inside it goes.
 */
export function clearRules(c: ActionContext, scope: 'selection' | 'sheet'): number {
  const cut = c.selection().rect;
  const sheet = c.model.engine.sheet(c.sheetId);
  if (!sheet) return 0;
  let touched = 0;
  c.model.batch(() => {
    for (const { id, rule, rects } of rulesOf(c)) {
      if (scope === 'sheet') {
        c.model.setRule(c.sheetId, 'cf', id, null);
        touched++;
        continue;
      }
      const left = subtractAll(rects, cut);
      if (left.reduce((n, r) => n + cellCount(r), 0) === rects.reduce((n, r) => n + cellCount(r), 0)) continue;
      touched++;
      const ranges = idRects(c, left);
      c.model.setRule(c.sheetId, 'cf', id, ranges.length ? { ...rule, ranges } : null);
    }
  });
  return touched;
}

// ── formulas ────────────────────────────────────────────────────────────────

/** A formula typed for a rule, in the form the model stores it, or why it would not read. */
export function storeFormula(c: Pick<ActionContext, 'model' | 'sheetId'>, text: string): { ok: true; f: string } | { ok: false; message: string } {
  const t = text.trim();
  if (!t || t === '=') return { ok: false, message: 'Type a formula.' };
  const r = c.model.engine.contentFromInput(c.sheetId, t.startsWith('=') ? t : `=${t}`);
  if (r.kind === 'error') return { ok: false, message: r.message };
  if (r.kind === 'grow') return { ok: false, message: 'That reaches past the edge of the sheet.' };
  return r.content?.f ? { ok: true, f: r.content.f } : { ok: false, message: 'Type a formula.' };
}

/** A stored formula as a person types it, with its `=`. */
export const showFormula = (c: Pick<ActionContext, 'model' | 'sheetId'>, stored: string): string => {
  const a1 = c.model.engine.displayStored(c.sheetId, stored);
  return a1 === undefined ? '' : a1.startsWith('=') ? a1 : `=${a1}`;
};

// ── describing a rule ───────────────────────────────────────────────────────

const OPS: Record<Comparison, string> = {
  gt: 'greater than',
  ge: 'greater than or equal to',
  lt: 'less than',
  le: 'less than or equal to',
  eq: 'equal to',
  ne: 'not equal to',
  between: 'between',
  notBetween: 'not between'
};

export const COMPARISONS: readonly { op: Comparison; label: string }[] = (Object.keys(OPS) as Comparison[]).map((op) => ({ op, label: OPS[op] }));

const quote = (v: number | string): string => (typeof v === 'number' ? String(v) : `“${v}”`);

/** One line for the manager's list: what the rule looks for. */
export function describe(when: CfCondition, c?: Pick<ActionContext, 'model' | 'sheetId'>): string {
  switch (when.kind) {
    case 'cell':
      return when.op === 'between' || when.op === 'notBetween'
        ? `Cell value ${OPS[when.op]} ${quote(when.a)} and ${quote(when.b ?? when.a)}`
        : `Cell value ${OPS[when.op]} ${quote(when.a)}`;
    case 'text':
      return `Text ${{ contains: 'contains', notContains: 'does not contain', begins: 'begins with', ends: 'ends with' }[when.op]} “${when.text}”`;
    case 'blank':
      return 'Blank cells';
    case 'notBlank':
      return 'Cells that are not blank';
    case 'error':
      return 'Cells with an error';
    case 'notError':
      return 'Cells without an error';
    case 'formula':
      return `Formula ${c ? showFormula(c, when.f) : when.f}`;
    case 'duplicate':
      return 'Duplicate values';
    case 'unique':
      return 'Unique values';
    case 'top':
      return `${when.bottom ? 'Bottom' : 'Top'} ${when.n}${when.percent ? '%' : ''}`;
    case 'average':
      return when.below ? 'Below average' : 'Above average';
    case 'scale':
      return when.mid ? 'Three-colour scale' : 'Two-colour scale';
    case 'bar':
      return 'Data bars';
  }
}

/** The ranges as a person reads them: `B2:B9, D2:D9`. */
export const rangesText = (rects: readonly Rect[]): string => rects.map(rectAddress).join(', ');

// ── presets ─────────────────────────────────────────────────────────────────

export interface LookPreset {
  id: string;
  label: string;
  style: CfStyle;
}

/** The looks the highlight rules offer, Excel's first. */
export const LOOKS: readonly LookPreset[] = [
  { id: 'red-fill-dark-red', label: 'Light red fill with dark red text', style: { fill: '#ffc7ce', color: '#9c0006' } },
  { id: 'yellow-fill-dark-yellow', label: 'Yellow fill with dark yellow text', style: { fill: '#ffeb9c', color: '#9c5700' } },
  { id: 'green-fill-dark-green', label: 'Green fill with dark green text', style: { fill: '#c6efce', color: '#006100' } },
  { id: 'red-fill', label: 'Light red fill', style: { fill: '#ffc7ce' } },
  { id: 'red-text', label: 'Dark red text', style: { color: '#9c0006' } },
  { id: 'bold', label: 'Bold', style: { bold: true } },
  { id: 'strike', label: 'Strikethrough, grey', style: { strike: true, color: '#75798c' } }
];

export const DEFAULT_LOOK = LOOKS[0]!.style;

export interface ScalePreset {
  id: string;
  label: string;
  min: string;
  mid?: string;
  max: string;
}

/** Excel's two- and three-colour scales. */
export const SCALES: readonly ScalePreset[] = [
  { id: 'green-yellow-red', label: 'Green, yellow, red', min: '#63be7b', mid: '#ffeb84', max: '#f8696b' },
  { id: 'red-yellow-green', label: 'Red, yellow, green', min: '#f8696b', mid: '#ffeb84', max: '#63be7b' },
  { id: 'blue-white-red', label: 'Blue, white, red', min: '#5a8ac6', mid: '#fcfcff', max: '#f8696b' },
  { id: 'red-white-blue', label: 'Red, white, blue', min: '#f8696b', mid: '#fcfcff', max: '#5a8ac6' },
  { id: 'white-green', label: 'White to green', min: '#ffffff', max: '#63be7b' },
  { id: 'green-white', label: 'Green to white', min: '#63be7b', max: '#ffffff' },
  { id: 'white-red', label: 'White to red', min: '#ffffff', max: '#f8696b' },
  { id: 'white-blue', label: 'White to blue', min: '#ffffff', max: '#5a8ac6' }
];

export interface BarPreset {
  id: string;
  label: string;
  color: string;
}

export const BARS: readonly BarPreset[] = [
  { id: 'blue', label: 'Blue', color: '#638ec6' },
  { id: 'green', label: 'Green', color: '#63be7b' },
  { id: 'red', label: 'Red', color: '#f8696b' },
  { id: 'orange', label: 'Orange', color: '#ffb628' },
  { id: 'purple', label: 'Purple', color: '#a78bd6' }
];

/** The negative colour a bar uses: a red, unless the bar is already red. */
export const negativeFor = (color: string): string => (color === '#f8696b' ? '#638ec6' : '#f8696b');

/** The selection with a scale on it, as one new rule. */
export function addScale(c: ActionContext, p: ScalePreset): string | undefined {
  return addRule(c, { rects: [c.selection().rect], when: { kind: 'scale', min: p.min, ...(p.mid ? { mid: p.mid } : {}), max: p.max }, style: {} });
}

export function addBars(c: ActionContext, p: BarPreset): string | undefined {
  return addRule(c, { rects: [c.selection().rect], when: { kind: 'bar', color: p.color, negative: negativeFor(p.color) }, style: {} });
}

/** A rule that needs no question asked: duplicates, top and bottom, above and below average, blanks. */
export function addQuick(c: ActionContext, when: CfCondition, style: CfStyle = DEFAULT_LOOK): string | undefined {
  return addRule(c, { rects: [c.selection().rect], when, style });
}
