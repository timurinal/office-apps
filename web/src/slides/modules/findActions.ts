/**
 * Find and replace over every slide's text and notes.
 *
 * What is searched: the text of every shape (a group's children, a placeholder), every table cell
 * that is not covered by a merge, and, when asked, each slide's speaker notes. Not searched: a chart's
 * title, a picture's alt text, the master and the layouts. A match is inside one paragraph; it may
 * run across runs of different formatting ("Hel" in bold and "lo" in italics is "Hello"), and a hard
 * break counts as one character.
 *
 * Matches are in reading order: by slide, then by object in the slide's back-to-front order (a
 * group's children where the group is, a table's cells row by row), then the notes, then by
 * paragraph and by position in it.
 *
 * Replace changes the text and nothing else: the replacement takes the formatting of the first
 * character it stands in for, so a bold word replaced is a bold word. **Replace all is one step**, one
 * undo entry however many slides it touches: the model's own text step is per slide, so this writes
 * the changed text of every slide inside one transaction under the model's step origin, after the
 * same checks (the role, the state cap, the schema) a step makes.
 *
 * Pure but for the Yjs transaction `replaceAll` and `replaceOne` write with: no DOM.
 */

import { LIMITS } from '@shared/api';
import type * as Y from 'yjs';
import type { SlideJSON, TextDoc, TextNode } from '../model/deck';
import { MESSAGES, StepOrigin, type SlideModel } from '../model/model';
import { textNode } from '../model/schema';
import { writeText } from '../model/ydoc';

export interface FindOptions {
  query: string;
  matchCase: boolean;
  /** Not in the middle of a longer word. */
  wholeWord: boolean;
  /** Search the speaker notes too. */
  notes: boolean;
}

export const DEFAULT_FIND: FindOptions = { query: '', matchCase: false, wholeWord: false, notes: true };

/** Where a body of text is on its slide. */
export type Place = { kind: 'shape'; el: string } | { kind: 'cell'; el: string; row: number; col: number } | { kind: 'notes' };

/** A match: a stretch of one paragraph of one body of text. Offsets are UTF-16 units, a hard break one. */
export interface Match {
  slide: string;
  /** The slide's place in the deck, from 0. */
  slideIndex: number;
  /** The body's place among the slide's bodies, from 0. */
  body: number;
  place: Place;
  para: number;
  start: number;
  end: number;
}

/** A place in reading order, for stepping from it. */
export type Position = Pick<Match, 'slideIndex' | 'body' | 'para' | 'start'>;

const placeKey = (p: Place): string => (p.kind === 'shape' ? `s:${p.el}` : p.kind === 'cell' ? `c:${p.el}:${p.row}:${p.col}` : 'notes');

/** One string for a match, the same until the text under it changes. */
export const matchKey = (m: Match): string => `${m.slide}|${placeKey(m.place)}|${m.para}|${m.start}`;

export const positionOf = (m: Position): Position => ({ slideIndex: m.slideIndex, body: m.body, para: m.para, start: m.start });

/** Negative when `a` comes first in reading order. */
export function comparePositions(a: Position, b: Position): number {
  return a.slideIndex - b.slideIndex || a.body - b.body || a.para - b.para || a.start - b.start;
}

const sameText = (a: Place, b: Place): boolean => placeKey(a) === placeKey(b);

// ── what a search looks for ─────────────────────────────────────────────────

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for the options, or null when there is nothing to look for. */
export function pattern(o: FindOptions): RegExp | null {
  if (o.query === '') return null;
  const body = escape(o.query);
  const source = o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(source, o.matchCase ? 'gu' : 'giu');
}

// ── text, as characters ─────────────────────────────────────────────────────

/** One position in a paragraph: a UTF-16 unit of text with its formatting, or a break or other inline node. */
interface Atom {
  ch: string;
  marks?: TextNode['marks'];
  /** Set for a node that is not text, kept as it was. */
  node?: TextNode;
}

function atomsOf(p: TextNode): Atom[] {
  const out: Atom[] = [];
  for (const n of p.content ?? []) {
    if (n.type === 'text') {
      const text = n.text ?? '';
      for (let i = 0; i < text.length; i++) out.push({ ch: text[i]!, ...(n.marks?.length ? { marks: n.marks } : {}) });
    } else out.push({ ch: n.type === 'hardBreak' ? '\n' : '￼', node: n });
  }
  return out;
}

/** A paragraph's text as the search sees it. */
export const paragraphText = (p: TextNode): string => atomsOf(p).map((a) => a.ch).join('');

const paragraphsOf = (doc: TextDoc | null | undefined): TextNode[] => (doc?.content ?? []).filter((n) => n.type === 'paragraph');

// ── the bodies of text on a slide ───────────────────────────────────────────

interface Body {
  place: Place;
  doc: TextDoc;
}

/** Every body of text on a slide, in reading order. */
export function bodiesOf(slide: SlideJSON, notes: boolean): Body[] {
  const out: Body[] = [];
  const walk = (els: SlideJSON['elements']): void => {
    for (const el of els) {
      const id = el.id;
      if (!id) continue;
      if (el.type === 'shape' && el.text) out.push({ place: { kind: 'shape', el: id }, doc: el.text });
      else if (el.type === 'table') {
        el.rows.forEach((row, r) =>
          row.cells.forEach((cell, c) => {
            if (!cell.merged && cell.text) out.push({ place: { kind: 'cell', el: id, row: r, col: c }, doc: cell.text });
          })
        );
      } else if (el.type === 'group') walk(el.children);
    }
  };
  walk(slide.elements);
  if (notes && slide.notes) out.push({ place: { kind: 'notes' }, doc: slide.notes });
  return out;
}

/** The stretches of a body's paragraphs the pattern matches. */
export function findInDoc(doc: TextDoc, re: RegExp): { para: number; start: number; end: number }[] {
  const out: { para: number; start: number; end: number }[] = [];
  paragraphsOf(doc).forEach((p, para) => {
    const text = paragraphText(p);
    if (!text) return;
    for (const m of text.matchAll(re)) {
      if (m[0] === '') continue;
      out.push({ para, start: m.index, end: m.index + m[0].length });
    }
  });
  return out;
}

// ── finding ─────────────────────────────────────────────────────────────────

/** A slide's matches for one set of options, kept while the slide is the same object (the model keeps it until it changes). */
const cache = new WeakMap<SlideJSON, Map<string, Omit<Match, 'slideIndex'>[]>>();

const optionsKey = (o: FindOptions): string => JSON.stringify([o.query, o.matchCase, o.wholeWord, o.notes]);

function inSlide(slide: SlideJSON, id: string, o: FindOptions, re: RegExp, key: string): Omit<Match, 'slideIndex'>[] {
  let byOptions = cache.get(slide);
  if (!byOptions) cache.set(slide, (byOptions = new Map()));
  const hit = byOptions.get(key);
  if (hit) return hit;
  const found: Omit<Match, 'slideIndex'>[] = [];
  bodiesOf(slide, o.notes).forEach((b, body) => {
    for (const m of findInDoc(b.doc, re)) found.push({ slide: id, body, place: b.place, ...m });
  });
  if (byOptions.size > 8) byOptions.clear();
  byOptions.set(key, found);
  return found;
}

/** Every match in the deck, in reading order. */
export function findAll(model: SlideModel, o: FindOptions): Match[] {
  const re = pattern(o);
  if (!re) return [];
  const key = optionsKey(o);
  const out: Match[] = [];
  model.order().forEach((id, slideIndex) => {
    const slide = model.slide(id);
    if (!slide) return;
    for (const m of inSlide(slide, id, o, re, key)) out.push({ ...m, slideIndex });
  });
  return out;
}

/**
 * The match to go to from `from`, forwards or backwards, wrapping at the ends. `from` is where the last
 * one was, or where the person is: the first match after it, or the last before it. Null with no matches.
 */
export function stepMatch(list: readonly Match[], from: Position | null, dir: 1 | -1): Match | null {
  if (!list.length) return null;
  if (!from) return dir > 0 ? list[0]! : list[list.length - 1]!;
  if (dir > 0) return list.find((m) => comparePositions(m, from) > 0) ?? list[0]!;
  for (let i = list.length - 1; i >= 0; i--) if (comparePositions(list[i]!, from) < 0) return list[i]!;
  return list[list.length - 1]!;
}

/** The text of the paragraph a match is in, as it is now: what the page's editor is checked against. */
export function paragraphOf(model: SlideModel, m: Match): string | null {
  const slide = model.slide(m.slide);
  const body = slide ? bodiesOf(slide, true).find((b) => sameText(b.place, m.place)) : undefined;
  const p = body ? paragraphsOf(body.doc)[m.para] : undefined;
  return p ? paragraphText(p) : null;
}

/** Where a search starts when nothing has been found yet: the top of the slide on screen. */
export const startOfSlide = (slideIndex: number): Position => ({ slideIndex, body: -1, para: -1, start: -1 });

// ── replacing ───────────────────────────────────────────────────────────────

interface Range {
  para: number;
  start: number;
  end: number;
}

/** Whether two atoms carry the same formatting. */
const sameMarks = (a: Atom, b: Atom): boolean => (a.marks === b.marks ? true : JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []));

function rewriteParagraph(p: TextNode, ranges: readonly { start: number; end: number }[], replacement: string): TextNode {
  const atoms = atomsOf(p);
  const out: Atom[] = [];
  let i = 0;
  for (const r of ranges) {
    while (i < r.start) out.push(atoms[i++]!);
    // The replacement is formatted as the first character it stands in for.
    const marks = atoms[r.start]?.marks;
    for (let k = 0; k < replacement.length; k++) out.push({ ch: replacement[k]!, ...(marks?.length ? { marks } : {}) });
    i = r.end;
  }
  while (i < atoms.length) out.push(atoms[i++]!);

  const content: TextNode[] = [];
  let run: { text: string; first: Atom } | null = null;
  const flush = () => {
    if (!run) return;
    content.push({ type: 'text', text: run.text, ...(run.first.marks?.length ? { marks: run.first.marks } : {}) });
    run = null;
  };
  for (const a of out) {
    if (a.node) {
      flush();
      content.push(a.node);
    } else if (run && sameMarks(run.first, a)) run.text += a.ch;
    else {
      flush();
      run = { text: a.ch, first: a };
    }
  }
  flush();
  const { content: _old, ...rest } = p;
  return content.length ? { ...rest, content } : rest;
}

/** A body with the ranges replaced. Ranges are of the body as it is now, and may not overlap. */
export function replaceRanges(doc: TextDoc, ranges: readonly Range[], replacement: string): TextDoc {
  const byPara = new Map<number, Range[]>();
  for (const r of ranges) byPara.set(r.para, [...(byPara.get(r.para) ?? []), r]);
  let para = -1;
  const content = doc.content.map((n) => {
    if (n.type !== 'paragraph') return n;
    para += 1;
    const mine = byPara.get(para);
    return mine ? rewriteParagraph(n, [...mine].sort((a, b) => a.start - b.start), replacement) : n;
  });
  return { ...doc, content };
}

/** A body with every match replaced, and how many there were. */
export function replaceInDoc(doc: TextDoc, re: RegExp, replacement: string): { doc: TextDoc; count: number } {
  const found = findInDoc(doc, re);
  return found.length ? { doc: replaceRanges(doc, found, replacement), count: found.length } : { doc, count: 0 };
}

// ── writing ─────────────────────────────────────────────────────────────────

/** One body of text, changed. */
export interface Edit {
  slide: string;
  place: Place;
  doc: TextDoc;
}

export type Outcome = 'done' | 'nothing' | 'read-only' | 'too-large' | 'invalid';

/** The notice for a refusal, in the product's words. */
export const OUTCOME_TEXT: Partial<Record<Outcome, string>> = {
  'read-only': MESSAGES.readOnly,
  'too-large': MESSAGES.size,
  invalid: MESSAGES.invalid
};

function fragmentFor(model: SlideModel, e: Edit): Y.XmlFragment | null {
  if (e.place.kind === 'shape') return model.textFragment(e.slide, e.place.el);
  if (e.place.kind === 'cell') return model.cellFragment(e.slide, e.place.el, e.place.row, e.place.col);
  return model.notesFragment(e.slide);
}

/**
 * Writes the edits as one step: one transaction, one undo entry, whatever the number of slides. It makes
 * the checks a model step makes first, and writes nothing when one fails.
 */
export function applyEdits(model: SlideModel, edits: readonly Edit[]): Outcome {
  if (!edits.length) return 'nothing';
  if (model.isReadOnly) return 'read-only';
  const work = edits.map((e) => ({ frag: fragmentFor(model, e), doc: e.doc })).filter((w): w is { frag: Y.XmlFragment; doc: TextDoc } => w.frag !== null);
  if (!work.length) return 'nothing';
  try {
    for (const w of work) textNode(w.doc);
  } catch {
    return 'invalid';
  }
  const added = work.reduce((n, w) => n + JSON.stringify(w.doc).length, 0);
  if (model.bytes() + added > LIMITS.docStateMaxBytes) return 'too-large';
  model.fixRepeats();
  model.undoManager.stopCapturing();
  model.doc.transact(() => {
    for (const w of work) writeText(w.frag, w.doc);
  }, new StepOrigin('replace-text'));
  model.undoManager.stopCapturing();
  return 'done';
}

export interface Replaced {
  outcome: Outcome;
  /** How many matches were replaced. */
  count: number;
  /** In how many slides. */
  slides: number;
}

/** Every match in the deck replaced, as one step. */
export function replaceAll(model: SlideModel, o: FindOptions, replacement: string): Replaced {
  const re = pattern(o);
  if (!re) return { outcome: 'nothing', count: 0, slides: 0 };
  const edits: Edit[] = [];
  const touched = new Set<string>();
  let count = 0;
  for (const id of model.order()) {
    const slide = model.slide(id);
    if (!slide) continue;
    for (const b of bodiesOf(slide, o.notes)) {
      const r = replaceInDoc(b.doc, re, replacement);
      if (!r.count) continue;
      edits.push({ slide: id, place: b.place, doc: r.doc });
      touched.add(id);
      count += r.count;
    }
  }
  const outcome = applyEdits(model, edits);
  return outcome === 'done' ? { outcome, count, slides: touched.size } : { outcome, count: 0, slides: 0 };
}

/** One match replaced, if the text is still as it was found. */
export function replaceOne(model: SlideModel, m: Match, o: FindOptions, replacement: string): Replaced {
  const re = pattern(o);
  const slide = model.slide(m.slide);
  const body = slide ? bodiesOf(slide, o.notes).find((b) => sameText(b.place, m.place)) : undefined;
  if (!re || !body) return { outcome: 'nothing', count: 0, slides: 0 };
  const range = findInDoc(body.doc, re).find((r) => r.para === m.para && r.start === m.start && r.end === m.end);
  if (!range) return { outcome: 'nothing', count: 0, slides: 0 };
  const outcome = applyEdits(model, [{ slide: m.slide, place: m.place, doc: replaceRanges(body.doc, [range], replacement) }]);
  return outcome === 'done' ? { outcome, count: 1, slides: 1 } : { outcome, count: 0, slides: 0 };
}

/** What the notice after a replace says. */
export function replacedText(r: Replaced): string {
  if (r.outcome !== 'done') return OUTCOME_TEXT[r.outcome] ?? 'Nothing to replace.';
  const matches = r.count === 1 ? '1 match' : `${r.count.toLocaleString('en-GB')} matches`;
  return r.slides > 1 ? `Replaced ${matches} on ${r.slides.toLocaleString('en-GB')} slides.` : `Replaced ${matches}.`;
}
