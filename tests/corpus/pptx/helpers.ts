/**
 * What the pptx corpus tests share: where the files are, an independent count of a file's slides,
 * and a deck flattened to an outline so two decks can be compared and a person can read the
 * difference.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import type { DeckJSON, ElementJSON, TextDoc, TextNode } from '../../../web/src/slides/model/deck';

export const DIR = dirname(fileURLToPath(import.meta.url));
export const HOSTILE = join(DIR, 'hostile');
export const OUT_DIR = join(DIR, 'out');

export const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

export const listDecks = (): string[] =>
  readdirSync(DIR)
    .filter((f) => f.endsWith('.pptx'))
    .sort();

export const listHostile = (): string[] =>
  readdirSync(HOSTILE)
    .filter((f) => f.endsWith('.pptx'))
    .sort();

export interface Expect {
  dialect: 'powerpoint' | 'google' | 'libreoffice' | 'python-pptx';
  size: '16:9' | '4:3' | '16:10';
  slides: number;
  layouts: string[];
  slideLayouts: string[];
  hidden: boolean[];
  notes: (string | null)[];
  transitions: (string | null)[];
  elements: ExpectedElement[][];
  charts: { chart: string; categories: string[]; series: { name: string; values: number[] }[]; title: string | null }[];
  warnings: string[];
  [key: string]: unknown;
}

export interface ExpectedElement {
  kind: string;
  box?: [number, number, number, number];
  text?: string | null;
  ph?: string;
  rows?: number;
  cols?: number;
  tableTexts?: string[];
  crop?: Record<string, number>;
  alt?: string;
  children?: ExpectedElement[];
}

export const expectOf = (name: string): Expect => JSON.parse(readFileSync(join(DIR, name.replace(/\.pptx$/, '.expect.json')), 'utf8')) as Expect;

/**
 * The number of slides a file lists in `presentation.xml`, counted on the text and with none of
 * the reader's code: the standard the reader must not fall short of.
 */
export function sldIdCount(bytes: Uint8Array): number {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'ppt/presentation.xml' });
  const xml = strFromU8(files['ppt/presentation.xml']!);
  const list = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(xml)?.[1] ?? '';
  return (list.match(/<p:sldId\s/g) ?? []).length;
}

// ── text ────────────────────────────────────────────────────────────────────

const nodeText = (n: TextNode): string => (n.type === 'hardBreak' ? '\n' : (n.text ?? '') + (n.content ?? []).map(nodeText).join(''));

export const plain = (doc: TextDoc | undefined): string => (doc?.content ?? []).map(nodeText).join('\n');

/** The text an element shows, in the order the generator records it: null when it shows none. */
export function textOf(e: ElementJSON): string | null {
  switch (e.type) {
    case 'shape': {
      const t = plain(e.text);
      return t.trim() === '' ? null : t;
    }
    case 'table': {
      const cells = e.rows.flatMap((r) => r.cells.filter((c) => !c.merged).map((c) => plain(c.text))).filter((t) => t.trim() !== '');
      return cells.length > 0 ? cells.join('\n') : null;
    }
    case 'group': {
      const kids = e.children.map(textOf).filter((t): t is string => t !== null);
      return kids.length > 0 ? kids.join('\n') : null;
    }
    default:
      return null;
  }
}

// ── outline ─────────────────────────────────────────────────────────────────

export interface ElOutline {
  kind: string;
  ph?: string;
  idx?: number;
  text: string | null;
  box: [number, number, number, number];
  rot?: number;
  children?: ElOutline[];
  table?: { rows: number; cols: number; spans: string[]; texts: string[] };
  chart?: { chart: string; categories: string[]; series: { name: string; values: number[] }[] };
  image?: { data?: string; crop?: string };
  shape?: string;
}

export interface DeckOutline {
  size: string;
  layouts: { name: string; placeholders: string[] }[];
  slides: { layout: string; hidden: boolean; showMaster: boolean; notes: string | null; transition: string | null; from: string | null; elements: ElOutline[] }[];
}

export function outlineEl(e: ElementJSON): ElOutline {
  const out: ElOutline = { kind: e.type, text: textOf(e), box: [e.x, e.y, e.w, e.h] };
  if ('ph' in e && e.ph) {
    out.ph = e.ph.type;
    if (e.ph.idx !== undefined) out.idx = e.ph.idx;
  }
  if (e.rot) out.rot = e.rot;
  switch (e.type) {
    case 'shape':
      out.shape = e.shape;
      break;
    case 'group':
      out.children = e.children.map(outlineEl);
      break;
    case 'table':
      out.table = {
        rows: e.rows.length,
        cols: e.cols.length,
        spans: e.rows.flatMap((r, ri) => r.cells.flatMap((c, ci) => (c.rowSpan || c.colSpan || c.merged ? [`${ri},${ci}:${c.rowSpan ?? 1}x${c.colSpan ?? 1}${c.merged ? 'm' : ''}`] : []))),
        texts: e.rows.flatMap((r) => r.cells.map((c) => plain(c.text)))
      };
      break;
    case 'chart':
      out.chart = { chart: e.chart, categories: e.categories, series: e.series.map((s) => ({ name: s.name, values: s.values })) };
      break;
    case 'image':
      out.image = { ...(e.asset.data ? { data: e.asset.data } : {}), ...(e.crop ? { crop: JSON.stringify(e.crop) } : {}) };
      break;
    default:
      break;
  }
  return out;
}

export function outline(deck: DeckJSON): DeckOutline {
  const layoutName = new Map(deck.layouts.map((l) => [l.id, l.name]));
  return {
    size: deck.size,
    layouts: deck.layouts.map((l) => ({ name: l.name, placeholders: l.elements.filter((e) => 'ph' in e && e.ph).map((e) => `${(e as { ph: { type: string } }).ph.type}`) })),
    slides: deck.slides.map((s) => ({
      layout: layoutName.get(s.layout) ?? '?',
      hidden: s.hidden === true,
      showMaster: s.showMaster !== false,
      notes: s.notes ? plain(s.notes) : null,
      transition: s.transition && s.transition.kind !== 'none' ? s.transition.kind : null,
      from: s.transition?.from ?? null,
      elements: s.elements.map(outlineEl)
    }))
  };
}

/** Whether two boxes agree to within `tol` px on every number. */
export const near = (a: readonly number[], b: readonly number[], tol = 1): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= tol);

export function allElements(deck: DeckJSON): ElementJSON[] {
  const out: ElementJSON[] = [];
  const walk = (e: ElementJSON): void => {
    out.push(e);
    if (e.type === 'group') e.children.forEach(walk);
  };
  for (const s of deck.slides) s.elements.forEach(walk);
  return out;
}
