/**
 * The deck's elements as PresentationML shapes.
 *
 * Every element is written with its own geometry, placeholders included, so a layout that is
 * edited later does not move a slide's text. A placeholder is written with the `idx` of the
 * layout placeholder it matches, which is how PowerPoint, python-pptx and this reader's
 * `inherit.ts` find the layout's prompt and text style for it.
 */

import type {
  ChartElement,
  ElementJSON,
  GroupElement,
  ImageElement,
  LayoutJSON,
  LineElement,
  Placeholder,
  PlaceholderType,
  ShapeElement,
  TableCell,
  TableElement
} from '../../slides/model/deck';
import type { Warnings } from '../types';
import { pick } from './part';
import { hasText } from './text';
import { levelsEl, paragraphs, txBody, type TextOut } from './writeText';
import { toEmu, type Space } from './units';
import { asColor, clean, el, fillEl, list, lnEl, NS_A, NS_C, NS_R, obj, srcRect, type ImageSink } from './xmlOut';

/** The placeholders a layout has, with the `idx` each was written with. */
export interface PhPlan {
  type: PlaceholderType;
  idx?: number;
}

export interface MediaRef {
  /** The target from a part in `ppt/slides/`, `ppt/slideLayouts/` or `ppt/slideMasters/`. */
  target: string;
  width?: number;
  height?: number;
}

/** What a part being written needs from the rest of the package. */
export interface PartOut extends TextOut {
  warnings: Warnings;
  /** The picture for an asset, already fetched; null if there is none. */
  media(asset: unknown): MediaRef | null;
  /** Adds a chart part and returns its target from this part; null for a chart that cannot be written. */
  chart(parts: ChartData): string | null;
  /** Shape ids, 2 up. */
  nextId(): number;
  /** On a layout: the text styles its placeholders state, written into their `lstStyle`. */
  phStyles?: LayoutJSON['styles'];
  /** For a slide, its layout's placeholders, and the idx values its own have taken. */
  layoutPhs?: PhPlan[];
  taken?: Set<number>;
  /** The layout's own plan, filled as its placeholders are written. */
  plan?: PhPlan[];
}

export type ChartData = Pick<ChartElement, 'chart' | 'categories' | 'series' | 'title'>;

export const imageSink = (out: PartOut): ImageSink => ({
  embed(asset) {
    const m = out.media(asset);
    // A picture that could not be fetched was counted when the package fetched it.
    if (!m) return null;
    return { rId: out.rels.add('image', m.target), ...(m.width ? { width: m.width } : {}), ...(m.height ? { height: m.height } : {}) };
  }
});

const finite = (n: unknown, fallback = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

function xfrmEl(tag: string, e: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, space: Space, group = false): string {
  const x = toEmu(space, finite(e.x));
  const y = toEmu(space, finite(e.y));
  const cx = Math.max(0, toEmu(space, finite(e.w)));
  const cy = Math.max(0, toEmu(space, finite(e.h)));
  const rot = finite(e.rot);
  const kids = el('a:off', { x, y }) + el('a:ext', { cx, cy }) + (group ? el('a:chOff', { x, y }) + el('a:chExt', { cx, cy }) : '');
  return el(tag, { rot: !group && rot ? Math.round((((rot % 360) + 360) % 360) * 60_000) : undefined, flipH: !group && e.flipH === true, flipV: !group && e.flipV === true }, kids);
}

const nameOf = (e: { name?: string }, fallback: string): string => clean(typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 200) : fallback);

function cNvPr(id: number, e: { name?: string; alt?: string }, fallback: string): string {
  return el('p:cNvPr', { id, name: nameOf(e, fallback), descr: typeof e.alt === 'string' && e.alt ? clean(e.alt).slice(0, 1000) : undefined });
}

// ── placeholders ────────────────────────────────────────────────────────────

const PH_TYPE: Record<PlaceholderType, string> = {
  title: 'title',
  ctrTitle: 'ctrTitle',
  subTitle: 'subTitle',
  body: 'body',
  pic: 'pic',
  dt: 'dt',
  ftr: 'ftr',
  sldNum: 'sldNum'
};

const DEFAULT_IDX: Partial<Record<PlaceholderType, number>> = { dt: 10, ftr: 11, sldNum: 12 };

/** The `p:ph` for a placeholder element, with the idx it takes from the layout (or, on a layout, makes). */
function phEl(ph: Placeholder, out: PartOut): string {
  const type: PlaceholderType = pick(PH_TYPE, ph.type) ? ph.type : 'body';
  let idx: number | undefined;
  if (out.plan) {
    // A layout: a title has none; anything else keeps its own if unique, else the next free.
    if (type !== 'title' && type !== 'ctrTitle') {
      const taken = new Set(out.plan.map((p) => p.idx));
      idx = typeof ph.idx === 'number' && !taken.has(ph.idx) ? ph.idx : DEFAULT_IDX[type] !== undefined && !taken.has(DEFAULT_IDX[type]) ? DEFAULT_IDX[type] : undefined;
      for (let i = 1; idx === undefined; i++) if (!taken.has(i)) idx = i;
    }
    out.plan.push({ type, ...(idx !== undefined ? { idx } : {}) });
  } else if (out.layoutPhs && type !== 'title' && type !== 'ctrTitle') {
    const taken = (out.taken ??= new Set<number>());
    const free = (p: PhPlan): boolean => p.idx === undefined || !taken.has(p.idx);
    const same = out.layoutPhs.find((p) => typeof ph.idx === 'number' && p.idx === ph.idx && free(p) && kind(p.type) === kind(type));
    const pick = same ?? out.layoutPhs.find((p) => p.type === type && free(p)) ?? out.layoutPhs.find((p) => kind(p.type) === kind(type) && free(p));
    idx = pick?.idx ?? (typeof ph.idx === 'number' ? ph.idx : undefined);
    if (idx !== undefined) taken.add(idx);
  }
  const sz = type === 'dt' ? 'half' : type === 'ftr' || type === 'sldNum' ? 'quarter' : undefined;
  return el('p:ph', { type: pick(PH_TYPE, type), sz, idx });
}

const kind = (t: PlaceholderType): string => (t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : 'body');

// ── elements ────────────────────────────────────────────────────────────────

const SHADOW =
  '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>';

function shapeXml(e: ShapeElement, out: PartOut): string {
  const id = out.nextId();
  const space = out.space;
  const kindName = typeof e.shape === 'string' && /^[A-Za-z0-9]{2,40}$/.test(e.shape) ? e.shape : 'rect';
  const adj = kindName === 'roundRect' && typeof e.adjust === 'number' ? el('a:gd', { name: 'adj', fmla: `val ${Math.round(Math.min(0.5, Math.max(0, e.adjust)) * 100_000)}` }) : '';
  const fill = e.fill ? fillEl(e.fill, imageSink(out), { w: e.w, h: e.h }) : '<a:noFill/>';
  const spPr = el(
    'p:spPr',
    {},
    xfrmEl('a:xfrm', e, space) + el('a:prstGeom', { prst: kindName }, el('a:avLst', {}, adj)) + fill + lnEl(e.line, (px) => toEmu(space, px)) + (e.shadow ? SHADOW : '')
  );
  const hasBody = e.ph !== undefined || (e.text !== undefined && hasText(e.text));
  const lst = e.ph && out.phStyles?.[e.ph.type] ? levelsEl(out.phStyles[e.ph.type], out) : '';
  const body = hasBody ? txBody('p:txBody', e.text, e.textBox, out, lst) : '';
  const lock = e.ph ? el('p:cNvSpPr', {}, el('a:spLocks', { noGrp: true })) : el('p:cNvSpPr', { txBox: !e.ph && e.fill?.kind === 'none' && !e.line && e.text !== undefined && kindName === 'rect' });
  return el('p:sp', {}, el('p:nvSpPr', {}, cNvPr(id, e, `${e.ph ? 'Placeholder' : 'Shape'} ${id}`) + lock + el('p:nvPr', {}, e.ph ? phEl(e.ph, out) : '')) + spPr + body);
}

function lineXml(e: LineElement, out: PartOut): string {
  const id = out.nextId();
  const space = out.space;
  const spPr = el('p:spPr', {}, xfrmEl('a:xfrm', e, space) + el('a:prstGeom', { prst: 'line' }, '<a:avLst/>') + lnEl(e.line, (px) => toEmu(space, px)));
  return el('p:cxnSp', {}, el('p:nvCxnSpPr', {}, cNvPr(id, e, `Line ${id}`) + '<p:cNvCxnSpPr/>' + '<p:nvPr/>') + spPr);
}

function imageXml(e: ImageElement, out: PartOut): string {
  const img = imageSink(out).embed(e.asset);
  if (!img) return '';
  const id = out.nextId();
  const space = out.space;
  const crop = e.crop ? srcRect({ l: finite(e.crop.l), t: finite(e.crop.t), r: finite(e.crop.r), b: finite(e.crop.b) }) : '';
  const spPr = el('p:spPr', {}, xfrmEl('a:xfrm', e, space) + el('a:prstGeom', { prst: 'rect' }, '<a:avLst/>') + (e.line ? lnEl(e.line, (px) => toEmu(space, px)) : ''));
  return el(
    'p:pic',
    {},
    el('p:nvPicPr', {}, cNvPr(id, e, `Picture ${id}`) + el('p:cNvPicPr', {}, el('a:picLocks', { noChangeAspect: true })) + el('p:nvPr', {}, e.ph ? phEl(e.ph, out) : '')) +
      el('p:blipFill', {}, el('a:blip', { 'r:embed': img.rId }) + crop + el('a:stretch', {}, '<a:fillRect/>')) +
      spPr
  );
}

function groupXml(e: GroupElement, out: PartOut): string {
  const kids = list<ElementJSON>(e.children).map((c) => elementXml(c, out)).join('');
  if (kids === '') return '';
  const id = out.nextId();
  return el('p:grpSp', {}, el('p:nvGrpSpPr', {}, cNvPr(id, e, `Group ${id}`) + '<p:cNvGrpSpPr/><p:nvPr/>') + el('p:grpSpPr', {}, xfrmEl('a:xfrm', e, out.space, true)) + kids);
}

// ── tables ──────────────────────────────────────────────────────────────────

const TABLE_STYLE = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';
const CELL_ANCHOR: Record<string, string> = { top: 't', middle: 'ctr', bottom: 'b' };

function tableXml(e: TableElement, out: PartOut): string {
  const space = out.space;
  const rows = list<TableElement['rows'][number]>(e.rows).filter((r) => obj(r) !== null);
  const cols = Array.isArray(e.cols) ? e.cols.map((c) => Math.max(0, toEmu(space, finite(c)))) : [];
  if (rows.length === 0 || cols.length === 0) return '';
  const id = out.nextId();

  // Which cell covers each merged cell, to say whether it continues a row or a column.
  const origin = new Map<string, { r: number; c: number }>();
  rows.forEach((row, r) =>
    list<TableCell>(row.cells).forEach((cell, c) => {
      if (!cell || cell.merged) return;
      const rs = Math.max(1, Math.round(finite(cell.rowSpan, 1)));
      const cs = Math.max(1, Math.round(finite(cell.colSpan, 1)));
      if (rs === 1 && cs === 1) return;
      for (let rr = r; rr < Math.min(rows.length, r + rs); rr++) for (let cc = c; cc < Math.min(cols.length, c + cs); cc++) if (rr !== r || cc !== c) origin.set(`${rr},${cc}`, { r, c });
    })
  );

  const border = e.border && asColor(e.border.color) && finite(e.border.width) > 0 ? e.border : undefined;
  const ln = (tag: string): string => (border ? lnEl(border, (px) => toEmu(space, px), tag) : '');

  const cellXml = (cell: TableCell, r: number, c: number): string => {
    const o = origin.get(`${r},${c}`);
    const covered = cell.merged === true && o !== undefined;
    const cs = covered ? 1 : Math.max(1, Math.round(finite(cell.colSpan, 1)));
    const rs = covered ? 1 : Math.max(1, Math.round(finite(cell.rowSpan, 1)));
    const attrs = {
      gridSpan: cs > 1 ? Math.min(cs, cols.length - c) : undefined,
      rowSpan: rs > 1 ? Math.min(rs, rows.length - r) : undefined,
      hMerge: covered && c > o!.c,
      vMerge: covered && r > o!.r
    };
    const fill = cell.fill ? fillEl(cell.fill, imageSink(out)) : '';
    const tcPr = el('a:tcPr', { anchor: pick(CELL_ANCHOR, cell.anchor) }, ln('a:lnL') + ln('a:lnR') + ln('a:lnT') + ln('a:lnB') + fill);
    const body = el('a:txBody', {}, '<a:bodyPr/><a:lstStyle/>' + paragraphs(covered ? undefined : cell.text, out));
    return el('a:tc', attrs, body + tcPr);
  };

  const grid = el('a:tblGrid', {}, cols.map((w) => el('a:gridCol', { w })).join(''));
  const trs = rows
    .map((row, r) => {
      const given = list<TableCell>(row.cells);
      const cells = Array.from({ length: cols.length }, (_, c) => obj<TableCell>(given[c]) ?? { text: { type: 'doc' as const, content: [{ type: 'paragraph' }] } });
      return el('a:tr', { h: Math.max(0, toEmu(space, finite(row.h))) }, cells.map((cell, c) => cellXml(cell, r, c)).join(''));
    })
    .join('');
  const styled = e.firstRow === true || e.bandRows === true;
  const tbl = el('a:tbl', {}, el('a:tblPr', { firstRow: e.firstRow === true, bandRow: e.bandRows === true }, el('a:tableStyleId', {}, styled ? TABLE_STYLE : NO_STYLE)) + grid + trs);
  const w = cols.reduce((a, b) => a + b, 0);
  const h = rows.reduce((a, r) => a + Math.max(0, toEmu(space, finite(r.h))), 0);
  const frame = el('p:xfrm', {}, el('a:off', { x: toEmu(space, finite(e.x)), y: toEmu(space, finite(e.y)) }) + el('a:ext', { cx: w, cy: h }));
  return el(
    'p:graphicFrame',
    {},
    el('p:nvGraphicFramePr', {}, cNvPr(id, e, `Table ${id}`) + el('p:cNvGraphicFramePr', {}, el('a:graphicFrameLocks', { noGrp: true })) + '<p:nvPr/>') +
      frame +
      el('a:graphic', {}, el('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/table' }, tbl))
  );
}

// ── charts ──────────────────────────────────────────────────────────────────

function chartXml(e: ChartElement, out: PartOut): string {
  const target = out.chart(e);
  if (!target) return '';
  const id = out.nextId();
  const rId = out.rels.add('chart', target);
  const frame = xfrmEl('p:xfrm', { x: e.x, y: e.y, w: e.w, h: e.h }, out.space);
  return el(
    'p:graphicFrame',
    {},
    el('p:nvGraphicFramePr', {}, cNvPr(id, e, `Chart ${id}`) + '<p:cNvGraphicFramePr/><p:nvPr/>') +
      frame +
      el('a:graphic', {}, el('a:graphicData', { uri: NS_C }, el('c:chart', { 'xmlns:c': NS_C, 'xmlns:r': NS_R, 'xmlns:a': NS_A, 'r:id': rId })))
  );
}

// ── dispatch ────────────────────────────────────────────────────────────────

export function elementXml(e: ElementJSON, out: PartOut): string {
  if (!e || typeof e !== 'object') return '';
  switch (e.type) {
    case 'shape':
      return shapeXml(e, out);
    case 'line':
      return lineXml(e, out);
    case 'image':
      return imageXml(e, out);
    case 'group':
      return groupXml(e, out);
    case 'table':
      return tableXml(e, out);
    case 'chart':
      return chartXml(e, out);
    default:
      return '';
  }
}

export const GROUP_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/** A shape tree's children, back to front. */
export function treeXml(elements: unknown, out: PartOut): string {
  return list<ElementJSON>(elements).map((e) => elementXml(e, out)).join('');
}
