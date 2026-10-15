/**
 * What the Format pane reads from the chosen elements, and the patches it makes for a change.
 *
 * Every control reads across the whole selection: a value that is the same on all of them is shown
 * and one that differs is blank (`common` answers null). Every change is a list of patches for the
 * model's `updateElements`, so it is one step for all of them and one undo entry, and live for the
 * other person the moment it is made.
 *
 * Fill, line, text box and alt text reach into groups: formatting a group formats the shapes in it,
 * as PowerPoint does. Size, position and turn are the chosen element's own, a group's included (the
 * model carries its children with it).
 *
 * Pure: no DOM.
 */

import type { Color, ElementJSON, Fill, Line, ShapeElement, TextBox } from '../../model/deck';
import { tint } from '../../model/color';
import type { ElementPatch } from '../../model/model';
import { paragraphStyle, type ResolvedStyle } from '../../model/styles';
import { insetsOf } from '../../render/paint';
import { round } from './units';

export type Patches = { id: string; patch: ElementPatch }[];

/** The smallest an element is made by typing a size, slide px; a line may be level or upright. */
export const MIN_SIZE = 4;

/** What a new outline is made of where a shape had none. */
export const DEFAULT_LINE: Line = { color: { theme: 'accent1' }, width: 3 };

const same = <T>(a: T, b: T): boolean => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/** The value every one of `values` has, or null when they differ or there are none. */
export function common<T>(values: readonly T[]): { value: T } | null {
  if (!values.length) return null;
  const first = values[0]!;
  return values.every((v) => same(v, first)) ? { value: first } : null;
}

// ── what a selection holds ──────────────────────────────────────────────────

/** The elements with every group replaced by what is in it. */
export function leaves(els: readonly ElementJSON[]): ElementJSON[] {
  const out: ElementJSON[] = [];
  const walk = (list: readonly ElementJSON[]) => {
    for (const e of list) {
      if (e.type === 'group') walk(e.children);
      else out.push(e);
    }
  };
  walk(els);
  return out;
}

export const shapesOf = (els: readonly ElementJSON[]): ShapeElement[] => leaves(els).filter((e): e is ShapeElement => e.type === 'shape');

/** Everything that has an outline: shapes, lines and pictures. */
export const strokablesOf = (els: readonly ElementJSON[]): ElementJSON[] => leaves(els).filter((e) => e.type === 'shape' || e.type === 'line' || e.type === 'image');

// ── size, position, turn ────────────────────────────────────────────────────

/** A width or a height typed in, for every element. One that has its aspect locked takes the other dimension with it. */
export function sizePatches(els: readonly ElementJSON[], which: 'w' | 'h', value: number): Patches {
  const other = which === 'w' ? 'h' : 'w';
  return els.map((el) => {
    const min = el.type === 'line' ? 0 : MIN_SIZE;
    const next = round(Math.max(min, value));
    const patch: ElementPatch = { [which]: next };
    if (el.lockAspect && el[which] > 0 && el[other] > 0) patch[other] = round(Math.max(min, (el[other] * next) / el[which]));
    return { id: el.id!, patch };
  });
}

export type From = 'topLeft' | 'centre';

/** A horizontal or vertical position typed in: of the top left corner, or of the centre. */
export function positionPatches(els: readonly ElementJSON[], axis: 'x' | 'y', value: number, from: From): Patches {
  const size = axis === 'x' ? 'w' : 'h';
  return els.map((el) => ({ id: el.id!, patch: { [axis]: round(from === 'centre' ? value - el[size] / 2 : value) } }));
}

export function readPosition(els: readonly ElementJSON[], axis: 'x' | 'y', from: From): { value: number } | null {
  const size = axis === 'x' ? 'w' : 'h';
  return common(els.map((el) => round(from === 'centre' ? el[axis] + el[size] / 2 : el[axis], 2)));
}

export const readSize = (els: readonly ElementJSON[], which: 'w' | 'h'): { value: number } | null => common(els.map((e) => round(e[which], 2)));

export const rotationPatches = (els: readonly ElementJSON[], deg: number): Patches => els.map((el) => ({ id: el.id!, patch: { rot: deg === 0 ? null : deg } }));

export const readRotation = (els: readonly ElementJSON[]): { value: number } | null => common(els.map((e) => round(e.rot ?? 0, 2)));

export const lockPatches = (els: readonly ElementJSON[], on: boolean): Patches => els.map((el) => ({ id: el.id!, patch: { lockAspect: on ? true : null } }));

export const readLock = (els: readonly ElementJSON[]): { value: boolean } | null => common(els.map((e) => !!e.lockAspect));

// ── fill ────────────────────────────────────────────────────────────────────

export type FillKind = Fill['kind'];

const fillOf = (s: ShapeElement): Fill => s.fill ?? { kind: 'none' };

/** The fill the shapes share: its kind and the fill itself, or `mixed`, or null when there are no shapes. */
export function readFill(shapes: readonly ShapeElement[]): { kind: FillKind | 'mixed'; fill: Fill | null } | null {
  if (!shapes.length) return null;
  const c = common(shapes.map(fillOf));
  return c ? { kind: c.value.kind, fill: c.value } : { kind: 'mixed', fill: null };
}

/** The kind of fill every shape has, or null when they differ: `readFill` for the choice, this for what is under it. */
export const readFillKind = (shapes: readonly ShapeElement[]): { value: FillKind } | null => common(shapes.map((s) => fillOf(s).kind));

/** The colour and the transparency of the solid fills among the shapes, each blank where they differ. */
export function readSolid(shapes: readonly ShapeElement[]): { color: { value: Color } | null; alpha: { value: number } | null } {
  const fills = shapes.map(fillOf).filter((f): f is Extract<Fill, { kind: 'solid' }> => f.kind === 'solid');
  return { color: common(fills.map((f) => f.color)), alpha: common(fills.map((f) => round(f.alpha ?? 1, 3))) };
}

/** The two ends and the angle of the gradients among the shapes, each blank where they differ. */
export function readGradient(shapes: readonly ShapeElement[]): { start: { value: Color } | null; end: { value: Color } | null; angle: { value: number } | null } {
  const fills = shapes.map(fillOf).filter((f): f is Extract<Fill, { kind: 'gradient' }> => f.kind === 'gradient');
  return {
    start: common(fills.map((f) => f.stops[0]?.color ?? '#000000')),
    end: common(fills.map((f) => f.stops[f.stops.length - 1]?.color ?? '#000000')),
    angle: common(fills.map((f) => round(f.angle, 2)))
  };
}

export const solid = (color: Color, alpha?: number): Fill => ({ kind: 'solid', color, ...(alpha !== undefined && alpha < 1 ? { alpha } : {}) });

/** The colour a fill leans on: a solid fill's, a gradient's first stop, else the theme's first accent. */
export function colorOf(fill: Fill | null | undefined): Color {
  if (fill?.kind === 'solid') return fill.color;
  if (fill?.kind === 'gradient') return fill.stops[0]?.color ?? { theme: 'accent1' };
  return { theme: 'accent1' };
}

/** `color` pushed toward black by `by`: the end of a gradient that starts at it. */
export function darker(color: Color, by = 0.3): Color {
  if (typeof color === 'string') return tint(color, -by);
  return { ...color, lum: Math.max(-1, (color.lum ?? 0) - by) };
}

/** A fill of a kind, started from the shape's own: what changing the kind keeps of the colour. */
export function fillOfKind(kind: FillKind, from: Fill | null | undefined): Fill {
  const color = colorOf(from);
  if (kind === 'none') return { kind: 'none' };
  if (kind === 'gradient') return from?.kind === 'gradient' ? from : { kind: 'gradient', angle: 90, stops: [{ at: 0, color }, { at: 1, color: darker(color) }] };
  return solid(color, from?.kind === 'solid' ? from.alpha : undefined);
}

/** A change to each shape's fill, built from that shape's own. */
export function fillPatches(shapes: readonly ShapeElement[], change: (fill: Fill) => Fill): Patches {
  return shapes.map((s) => ({ id: s.id!, patch: { fill: change(fillOf(s)) } }));
}

export const withColor = (fill: Fill, color: Color): Fill => (fill.kind === 'solid' ? solid(color, fill.alpha) : solid(color));

export const withAlpha = (fill: Fill, alpha: number): Fill => (fill.kind === 'solid' ? solid(fill.color, alpha) : fill);

export function withStop(fill: Fill, index: 0 | 1, color: Color): Fill {
  const base = fill.kind === 'gradient' ? fill : fillOfKind('gradient', fill);
  if (base.kind !== 'gradient') return base;
  const stops = base.stops.map((s, i) => (i === (index === 0 ? 0 : base.stops.length - 1) ? { ...s, color } : s));
  return { ...base, stops };
}

export function withAngle(fill: Fill, angle: number): Fill {
  const base = fill.kind === 'gradient' ? fill : fillOfKind('gradient', fill);
  return base.kind === 'gradient' ? { ...base, angle } : base;
}

// ── outline ─────────────────────────────────────────────────────────────────

/** A change to each element's outline, laid over its own (or over `DEFAULT_LINE` where it had none). */
export function linePatches(els: readonly ElementJSON[], change: Partial<Line>): Patches {
  return strokablesOf(els).map((el) => {
    const own = el.type === 'shape' || el.type === 'line' || el.type === 'image' ? el.line : undefined;
    return { id: el.id!, patch: { line: { ...DEFAULT_LINE, ...own, ...change } } };
  });
}

/** What every outlined element shares in `key`, with `fallback` for one that has none. */
export function readLine<K extends keyof Line>(els: readonly ElementJSON[], key: K, fallback: NonNullable<Line[K]>): { value: NonNullable<Line[K]> } | null {
  const lines = strokablesOf(els);
  return common(lines.map((el) => (((el.type === 'shape' || el.type === 'line' || el.type === 'image') && el.line ? el.line[key] : undefined) ?? fallback) as NonNullable<Line[K]>));
}

// ── the text box ────────────────────────────────────────────────────────────

/** A change to each shape's text box, laid over its own. */
export function textBoxPatches(shapes: readonly ShapeElement[], change: (box: TextBox) => TextBox): Patches {
  return shapes.map((s) => ({ id: s.id!, patch: { textBox: change(s.textBox ?? {}) } }));
}

export const withInset = (box: TextBox, side: 'l' | 't' | 'r' | 'b', px: number): TextBox => ({ ...box, insets: { ...insetsOf(box), [side]: round(Math.max(0, px)) } });

export function readTextBox<T>(shapes: readonly ShapeElement[], pick: (box: TextBox) => T): { value: T } | null {
  return common(shapes.map((s) => pick(s.textBox ?? {})));
}

// ── alt text ────────────────────────────────────────────────────────────────

export const altPatches = (els: readonly ElementJSON[], text: string): Patches => els.map((el) => ({ id: el.id!, patch: { alt: text.trim() ? text : null } }));

export const readAlt = (els: readonly ElementJSON[]): { value: string } | null => common(els.map((e) => e.alt ?? ''));

// ── a shape's own look ──────────────────────────────────────────────────────

export const shadowPatches = (shapes: readonly ShapeElement[], on: boolean): Patches => shapes.map((s) => ({ id: s.id!, patch: { shadow: on ? true : null } }));

export const readShadow = (shapes: readonly ShapeElement[]): { value: boolean } | null => common(shapes.map((s) => !!s.shadow));

/** A rounded rectangle's corner, as a fraction of its shorter side: 0 to 0.5. */
export const cornerPatches = (shapes: readonly ShapeElement[], fraction: number): Patches =>
  shapes.filter((s) => s.shape === 'roundRect').map((s) => ({ id: s.id!, patch: { adjust: round(Math.min(0.5, Math.max(0, fraction)), 4) } }));

// ── the text's paragraphs ───────────────────────────────────────────────────

/** The spacing every paragraph of the shapes' text has, through the cascade: null where two differ. */
export function readSpacing(
  shapes: readonly ShapeElement[],
  styleAt: (shapeId: string, level: number) => ResolvedStyle
): { before: { value: number } | null; after: { value: number } | null; line: { value: number } | null } {
  const styles: ResolvedStyle[] = [];
  for (const s of shapes) {
    const paras = (s.text?.content ?? []).filter((p) => p.type === 'paragraph');
    for (const p of paras.length ? paras : [{ type: 'paragraph' }]) styles.push(paragraphStyle((level) => styleAt(s.id!, level), (p as { attrs?: Record<string, unknown> }).attrs));
  }
  return {
    before: common(styles.map((s) => round(s.spaceBefore, 2))),
    after: common(styles.map((s) => round(s.spaceAfter, 2))),
    line: common(styles.map((s) => round(s.lineHeight, 2)))
  };
}

// ── knowing when the pane need not redraw ───────────────────────────────────

/** A table's structure and looks, without the text in its cells: what its pane shows. */
const tableSignature = (el: Extract<ElementJSON, { type: 'table' }>): string =>
  JSON.stringify([el.cols, el.firstRow, el.bandRows, el.rows.map((r) => [r.h, r.cells.map((c) => [c.merged, c.rowSpan, c.colSpan, c.fill, c.anchor])])]);

/**
 * Whether two lists of elements look the same to the pane: every field equal. The text of a shape and
 * of a table's cells are left out unless `text` says the pane shows them, so typing in a chosen shape
 * does not redraw a pane that has nothing to say about it.
 */
export function sameFormat(a: readonly ElementJSON[], b: readonly ElementJSON[], text: boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => sameElement(x, b[i]!, text));
}

function sameElement(a: ElementJSON, b: ElementJSON, text: boolean): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.id !== b.id) return false;
  if (a.type === 'group' && b.type === 'group') {
    if (!sameFormat(a.children, b.children, text)) return false;
  }
  if (a.type === 'table' && b.type === 'table' && !text && tableSignature(a) !== tableSignature(b)) return false;
  const skip = new Set(['children', ...(text ? [] : ['text']), ...(a.type === 'table' && !text ? ['rows'] : [])]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (!same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k])) return false;
  }
  return true;
}
