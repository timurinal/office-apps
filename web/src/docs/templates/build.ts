/**
 * Writing a template's content: small builders that return ProseMirror JSON.
 *
 * A template is a document in this editor's schema, so it is written as the JSON the schema
 * reads (`{ type: 'doc', content: [...] }`), and the builders only spare the nesting: a list
 * item is a paragraph inside a list item inside a list, and nobody should type that eight
 * times. They add no meaning of their own. What they return is what `seedState` (seed.ts)
 * validates, so a node in the wrong place fails the template's test rather than a reader.
 *
 * Only what differs from the schema's default is written: a paragraph with no attributes has
 * none, an empty paragraph has no content (a text node may not be empty).
 *
 * Type-only imports: this file is in Home's chunk (the cards are drawn from the content), so
 * it must not pull the editor in with it.
 */

import type { JSONContent } from '@tiptap/core';

/** A piece of a line: plain text, or a node a builder made (`bold('Date')`). */
export type Inline = string | JSONContent;
/** What a list item or a table cell holds: one piece or several. */
export type Pieces = Inline | Inline[];

const pieces = (x: Pieces): Inline[] => (Array.isArray(x) ? x : [x]);

const nodes = (parts: Inline[]): JSONContent[] =>
  parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x));

const withContent = (node: JSONContent, parts: Inline[]): JSONContent => {
  const content = nodes(parts);
  return content.length ? { ...node, content } : node;
};

const withAttrs = (type: string, attrs: Record<string, unknown>): JSONContent =>
  Object.keys(attrs).length ? { type, attrs } : { type };

// ── text ────────────────────────────────────────────────────────────────────

/** Marks go in the schema's order, and `textStyle` is last: `check()` refuses another order. */
export const bold = (value: string): JSONContent => ({ type: 'text', text: value, marks: [{ type: 'bold' }] });
export const italic = (value: string): JSONContent => ({ type: 'text', text: value, marks: [{ type: 'italic' }] });

/** Smaller text in a quieter colour: contact lines, dates. */
export const quiet = (value: string, size = 10): JSONContent => ({
  type: 'text',
  text: value,
  marks: [{ type: 'textStyle', attrs: { fontSize: `${size}pt`, color: '#595d6c' } }]
});

/** The whole document in one family, for a template whose look is its typeface. */
export function inFont(blocks: JSONContent[], family: string): JSONContent[] {
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'text') {
      // One `textStyle` per run: a mark of a type is on a node once.
      const marks = n.marks ?? [];
      const own = marks.find((m) => m.type === 'textStyle');
      return {
        ...n,
        marks: own
          ? marks.map((m) => (m === own ? { ...m, attrs: { ...m.attrs, fontFamily: family } } : m))
          : [...marks, { type: 'textStyle', attrs: { fontFamily: family } }]
      };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return blocks.map(walk);
}

// ── blocks ──────────────────────────────────────────────────────────────────

export interface ParagraphAttrs {
  paraStyle?: 'title' | 'subtitle' | 'nospacing';
  textAlign?: 'center' | 'right' | 'justify';
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
}

export const para = (attrs: ParagraphAttrs, ...parts: Inline[]): JSONContent =>
  withContent(withAttrs('paragraph', { ...attrs }), parts);

export const p = (...parts: Inline[]): JSONContent => para({}, ...parts);

/** A line in a run of lines with no gap between them: an address, a contact block. */
export const line = (...parts: Inline[]): JSONContent => para({ paraStyle: 'nospacing' }, ...parts);

export const title = (value: string, attrs: ParagraphAttrs = {}): JSONContent => para({ ...attrs, paraStyle: 'title' }, value);
export const subtitle = (value: string, attrs: ParagraphAttrs = {}): JSONContent => para({ ...attrs, paraStyle: 'subtitle' }, value);

export const heading = (level: 1 | 2 | 3, value: string, attrs: Pick<ParagraphAttrs, 'textAlign'> = {}): JSONContent => ({
  type: 'heading',
  attrs: { level, ...attrs },
  content: [{ type: 'text', text: value }]
});
export const h1 = (value: string): JSONContent => heading(1, value);
export const h2 = (value: string): JSONContent => heading(2, value);
export const h3 = (value: string): JSONContent => heading(3, value);

const item = (type: string, attrs: Record<string, unknown>, x: Pieces): JSONContent => ({
  type,
  ...(Object.keys(attrs).length ? { attrs } : {}),
  content: [p(...pieces(x))]
});

export const bullets = (...items: Pieces[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((x) => item('listItem', {}, x))
});
export const numbered = (...items: Pieces[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((x) => item('listItem', {}, x))
});
export const checklist = (...items: Pieces[]): JSONContent => ({
  type: 'taskList',
  content: items.map((x) => item('taskItem', { checked: false }, x))
});

export const quote = (...parts: Inline[]): JSONContent => ({ type: 'blockquote', content: [p(...parts)] });
export const rule = (): JSONContent => ({ type: 'horizontalRule' });
export const pageBreak = (): JSONContent => ({ type: 'pageBreak' });

/**
 * A table. The first row is the header row unless `header` is false, and a cell may be a
 * piece, a run of pieces, or an empty string for a cell to fill in.
 */
export function table(
  rows: Pieces[][],
  { header = true, widths = [] }: { header?: boolean; widths?: number[] } = {}
): JSONContent {
  return {
    type: 'table',
    content: rows.map((row, r) => ({
      type: 'tableRow',
      content: row.map((cell, c) => ({
        type: header && r === 0 ? 'tableHeader' : 'tableCell',
        // A column's width in pixels, for the columns that are given one: the labels of a
        // key and value table are narrower than half the page.
        ...(widths[c] ? { attrs: { colwidth: [widths[c]] } } : {}),
        content: [p(...pieces(cell))]
      }))
    }))
  };
}

// ── the table of contents ───────────────────────────────────────────────────

/** Headings 1 to 3, in order, as the page's own "Update table" takes them (pagination/nodes.ts). */
export function headingEntries(blocks: readonly JSONContent[]): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const text = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(text).join(''));
  const walk = (n: JSONContent) => {
    if (n.type === 'heading') {
      const level = Number(n.attrs?.level) || 1;
      const value = text(n).trim();
      if (level <= 3 && value) out.push({ level, text: value });
      return;
    }
    n.content?.forEach(walk);
  };
  blocks.forEach(walk);
  return out;
}

/**
 * A table of contents made from the headings in `blocks`. Page numbers are not stored: the
 * page reads them from its own layout each time the table is drawn.
 */
export const contents = (blocks: readonly JSONContent[]): JSONContent => ({
  type: 'tableOfContents',
  attrs: { entries: JSON.stringify(headingEntries(blocks)) }
});

// ── headers and footers ─────────────────────────────────────────────────────

/** A page number, the count, the date or the document's title, drawn where it is put. */
export const field = (kind: 'page' | 'pages' | 'date' | 'title'): JSONContent => ({ type: 'pageField', attrs: { kind } });
