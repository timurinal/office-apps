/**
 * Formatting applied to a shape's whole text, as plain values: what the ribbon does to the chosen
 * boxes when none of them has the caret (select a box, press Bold, and all of its text is bold).
 * The model writes the result as one step for every box (`setTexts`).
 *
 * And the other way: what the ribbon shows for those boxes. A value is the same across all the
 * text, or null when it differs.
 *
 * Pure: no DOM.
 */

import type { Bullet, TextDoc, TextNode } from '../model/deck';
import type { ResolvedStyle } from '../model/styles';
import { paragraphStyle } from '../model/styles';
import { MAX_LEVEL } from '../model/schema';

export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'sup' | 'sub';
export const MARK_NAMES: readonly MarkName[] = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub'];

/** A run's look, as the textStyle mark carries it. Null removes it, so the cascade shows. */
export interface StyleAttrs {
  fontFamily?: string | null;
  /** pt */
  fontSize?: number | null;
  color?: string | null;
}

/** A paragraph's own attributes. Null removes one, so the cascade shows. */
export interface ParaPatch {
  align?: 'left' | 'center' | 'right' | 'justify' | null;
  bullet?: Bullet | null;
  lineHeight?: number | null;
  spaceBefore?: number | null;
  spaceAfter?: number | null;
  level?: number | null;
}

const EXCLUDES: Partial<Record<MarkName, MarkName>> = { sup: 'sub', sub: 'sup' };

function textRuns(doc: TextDoc): TextNode[] {
  const out: TextNode[] = [];
  const walk = (n: TextNode) => {
    if (n.type === 'text' && n.text) out.push(n);
    n.content?.forEach(walk);
  };
  doc.content.forEach(walk);
  return out;
}

/** Each text run, rewritten; the rest of the tree as it was. */
function mapRuns(doc: TextDoc, fn: (n: TextNode) => TextNode): TextDoc {
  const walk = (n: TextNode): TextNode => {
    if (n.type === 'text') return fn(n);
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { ...doc, content: doc.content.map(walk) };
}

const withMarks = (n: TextNode, marks: NonNullable<TextNode['marks']>): TextNode => {
  const { marks: _drop, ...rest } = n;
  return marks.length ? { ...rest, marks } : rest;
};

/** Whether every run of the text has the mark. False for a text with no runs. */
export function hasMark(doc: TextDoc, name: MarkName): boolean {
  const runs = textRuns(doc);
  return runs.length > 0 && runs.every((r) => r.marks?.some((m) => m.type === name));
}

/** The mark on every run (`on`) or on none. */
export function setMark(doc: TextDoc, name: MarkName, on: boolean): TextDoc {
  const other = EXCLUDES[name];
  return mapRuns(doc, (n) => {
    const kept = (n.marks ?? []).filter((m) => m.type !== name && m.type !== other);
    return withMarks(n, on ? [...kept, { type: name }] : kept);
  });
}

/** Font, size and colour laid over every run: a null takes that one away. */
export function setStyle(doc: TextDoc, attrs: StyleAttrs): TextDoc {
  return mapRuns(doc, (n) => {
    const marks = n.marks ?? [];
    const had = marks.find((m) => m.type === 'textStyle');
    const merged: Record<string, unknown> = { ...(had?.attrs ?? {}) };
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue;
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === undefined) delete merged[k];
    const rest = marks.filter((m) => m.type !== 'textStyle');
    return withMarks(n, Object.keys(merged).length ? [...rest, { type: 'textStyle', attrs: merged }] : rest);
  });
}

/**
 * A run attribute that is the same on every run, or null when it differs or some run has none.
 * With no runs at all (an empty box), null.
 */
export function styleOf(doc: TextDoc, key: keyof StyleAttrs): string | number | null {
  const runs = textRuns(doc);
  if (!runs.length) return null;
  let value: unknown;
  for (const [i, r] of runs.entries()) {
    const v = r.marks?.find((m) => m.type === 'textStyle')?.attrs?.[key] ?? null;
    if (i === 0) value = v;
    else if (v !== value) return null;
  }
  return (value as string | number | null) ?? null;
}

/** Whether any run sets the attribute: if none does, what shows is the cascade's. */
export function anyStyle(doc: TextDoc, key: keyof StyleAttrs): boolean {
  return textRuns(doc).some((r) => r.marks?.some((m) => m.type === 'textStyle' && m.attrs?.[key] !== undefined && m.attrs?.[key] !== null));
}

/** Every paragraph's own attributes with the patch laid over them. */
export function setParagraphs(doc: TextDoc, patch: ParaPatch): TextDoc {
  return {
    ...doc,
    content: doc.content.map((p) => {
      if (p.type !== 'paragraph') return p;
      const attrs: Record<string, unknown> = { ...(p.attrs ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete attrs[k];
        else attrs[k] = v;
      }
      const { attrs: _drop, ...rest } = p;
      return Object.keys(attrs).length ? { ...rest, attrs } : rest;
    })
  };
}

/** Every paragraph one level deeper or shallower, from 0 to 8. */
export function shiftLevels(doc: TextDoc, by: 1 | -1): TextDoc {
  return {
    ...doc,
    content: doc.content.map((p) => {
      if (p.type !== 'paragraph') return p;
      const level = Math.max(0, Math.min(MAX_LEVEL, Number(p.attrs?.level ?? 0) + by));
      const attrs: Record<string, unknown> = { ...(p.attrs ?? {}) };
      if (level) attrs.level = level;
      else delete attrs.level;
      const { attrs: _drop, ...rest } = p;
      return Object.keys(attrs).length ? { ...rest, attrs } : rest;
    })
  };
}

/** What every paragraph resolves to, through the cascade; a field is null when two differ. */
export function resolvedParagraphs(doc: TextDoc, styleAt: (level: number) => ResolvedStyle): {
  align: ResolvedStyle['align'] | null;
  bullet: Bullet['kind'] | null;
  lineHeight: number | null;
} {
  const paras = doc.content.filter((p) => p.type === 'paragraph');
  const styles = (paras.length ? paras : [{ type: 'paragraph' } as TextNode]).map((p) => paragraphStyle(styleAt, p.attrs));
  const same = <T>(get: (s: ResolvedStyle) => T): T | null => {
    const first = get(styles[0]!);
    return styles.every((s) => get(s) === first) ? first : null;
  };
  return { align: same((s) => s.align), bullet: same((s) => s.bullet.kind), lineHeight: same((s) => s.lineHeight) };
}

/** The bullet a paragraph gets when bullets or numbering are turned on. */
export const BULLET_ON: Bullet = { kind: 'char', char: '•' };
export const NUMBER_ON: Bullet = { kind: 'number', style: 'arabicPeriod' };

/**
 * The paragraph patch that toggles bullets (`char`) or numbering: off when every paragraph
 * already has that kind, else on. "On" is the inherited bullet when it is already that kind, so a
 * body placeholder goes back to the master's bullet rather than a copy of it.
 */
export function bulletToggle(kind: 'char' | 'number', current: Bullet['kind'] | null, inherited: Bullet['kind']): ParaPatch {
  if (current === kind) return { bullet: { kind: 'none' } };
  if (inherited === kind) return { bullet: null };
  return { bullet: kind === 'char' ? BULLET_ON : NUMBER_ON };
}
