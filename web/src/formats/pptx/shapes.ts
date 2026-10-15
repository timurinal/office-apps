/**
 * A shape tree (`p:spTree`, or a group's body) as the deck's elements, back to front.
 *
 *   p:sp          a shape, a text box, a placeholder, or a straight line
 *   p:pic         a picture; a video or audio clip is its poster frame
 *   p:cxnSp       a connector; one that bends or curves is drawn straight
 *   p:grpSp       a group, its children carried to slide coordinates
 *   p:graphicFrame  a table, a chart, SmartArt (its cached drawing) or an OLE object (its picture)
 *
 * A placeholder takes what it does not state from the layers above it (`inherit.ts`). A freeform
 * (`custGeom`) is a rectangle of the same box and text: the deck has no path to draw. A shape the
 * file hides (`hidden`) is not read. Past `DECK_LIMITS` the rest is left out and said so.
 */

import {
  DECK_LIMITS,
  type ElementJSON,
  type Fill,
  type GroupElement,
  type ImageElement,
  type Line,
  type LineElement,
  type Placeholder,
  type ShapeElement,
  type TableElement
} from '../../slides/model/deck';
import { plural } from '../types';
import { child, descendants, elements, type XNode } from '../xml';
import { colorIn } from './color';
import { enter, relImage, relTarget, type PartCtx } from './ctx';
import { readChart } from './chart';
import { fillElement, readFill, readFillRef, readLine, readLineRef } from './fill';
import { adjustOf, geometryOf, readGroupXf, readXfrm, throughGroups, type GroupXf, type RawXfrm } from './geometry';
import { phElement, placeholderOf, type Inherit } from './inherit';
import { flag, int } from './part';
import { readTable } from './table';
import { finishBox, hasText, mergeBoxes, readBodyPr, readLevels, readTextBody } from './text';
import { toLen, toPx } from './units';

export interface TreeEnv {
  pc: PartCtx;
  inherit: Inherit;
  /** A master's placeholders are read separately, as the sources layers inherit from. */
  skipPlaceholders?: boolean;
  /** A layout's placeholders keep their text style on the layout (`LayoutJSON.styles`), not in their prompts. */
  layout?: boolean;
  /** Elements read so far on this part, and how many were refused past the limit. */
  budget: { read: number; refused: number };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Requires= tokens of `mc:Choice` that this reader understands the content of. */
const UNDERSTOOD = new Set(['p14', 'p15', 'p16', 'p159', 'a14', 'a15', 'a16', 'ahyp', 'pic14']);

/** The branch of `mc:AlternateContent` to read: the choice when it needs nothing exotic, else the fallback. */
function branch(ac: XNode): XNode | null {
  const choice = child(ac, 'mc:Choice');
  if (choice) {
    const needs = (choice.attrs.Requires ?? '').split(/\s+/).filter(Boolean);
    if (needs.every((r) => UNDERSTOOD.has(r))) return choice;
  }
  return child(ac, 'mc:Fallback');
}

const text200 = (v: string | undefined): string | undefined => {
  const s = v?.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return s ? s.slice(0, 200) : undefined;
};

type Placed = Pick<ElementJSON, 'x' | 'y' | 'w' | 'h' | 'rot' | 'flipH' | 'flipV'>;

function placed(xf: RawXfrm | null, env: TreeEnv, stack: readonly GroupXf[]): Placed {
  const space = env.pc.deck.space;
  const r = xf ? throughGroups(xf, stack) : { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false };
  const out: Placed = { x: toPx(space, r.x), y: toPx(space, r.y), w: toLen(space, r.w), h: toLen(space, r.h) };
  if (r.rot) out.rot = round2(r.rot);
  if (r.flipH) out.flipH = true;
  if (r.flipV) out.flipV = true;
  return out;
}

function names(cNvPr: XNode | null): { name?: string; alt?: string } {
  const out: { name?: string; alt?: string } = {};
  const name = text200(cNvPr?.attrs.name);
  const alt = text200(cNvPr?.attrs.descr);
  if (name) out.name = name;
  if (alt) out.alt = alt;
  return out;
}

/** Whether one more element may be read. */
function take(env: TreeEnv): boolean {
  if (env.budget.read >= DECK_LIMITS.elementsPerSlide) {
    env.budget.refused++;
    return false;
  }
  env.budget.read++;
  return true;
}

const hiddenIn = (cNvPr: XNode | null): boolean => flag(cNvPr, 'hidden') === true;

const bentWarning = (n: number): string => `${plural(n, 'elbow or curved connector')} ${n === 1 ? 'is drawn as a straight line' : 'are drawn as straight lines'}.`;

// ── a shape ─────────────────────────────────────────────────────────────────

const shadowOf = (spPr: XNode | null): boolean => !!child(child(spPr, 'a:effectLst'), 'a:outerShdw');

function lineOf(spPr: XNode | null, style: XNode | null, chain: readonly { line?: Line }[], pc: PartCtx): Line | undefined {
  const base = style ? readLineRef(child(style, 'a:lnRef'), pc) : undefined;
  const ln = child(spPr, 'a:ln');
  const line = ln ? readLine(ln, pc, base) : (chain.find((c) => c.line)?.line ?? base);
  return line && line.width > 0 ? line : undefined;
}

function readSp(sp: XNode, env: TreeEnv, stack: readonly GroupXf[], out: ElementJSON[]): void {
  const pc = env.pc;
  const nv = child(sp, 'p:nvSpPr');
  const cNvPr = child(nv, 'p:cNvPr');
  if (hiddenIn(cNvPr)) return;
  const phNode = phElement(sp);
  if (phNode && env.skipPlaceholders) return;
  const spPr = child(sp, 'p:spPr');
  const tx = child(sp, 'p:txBody');
  const style = child(sp, 'p:style');
  const ph: Placeholder | undefined = phNode ? placeholderOf(phNode) : undefined;
  const chain = ph ? env.inherit(ph) : [];
  const xf = readXfrm(child(spPr, 'a:xfrm')) ?? chain.find((c) => c.xfrm)?.xfrm ?? null;
  const geom = geometryOf(spPr);

  if ('line' in geom) {
    if (geom.bent) pc.deck.warnings.add('connector-bent', bentWarning);
    if (!take(env)) return;
    const line = lineOf(spPr, style, chain, pc) ?? defaultLine(pc);
    out.push({ type: 'line', ...placed(xf, env, stack), ...names(cNvPr), line });
    return;
  }
  if ('custom' in geom) pc.deck.warnings.add('shape-custom', (n) => `${plural(n, 'freeform shape')} ${n === 1 ? 'is' : 'are'} drawn as ${n === 1 ? 'a rectangle' : 'rectangles'}.`);
  else if ('unknown' in geom) pc.deck.warnings.add('shape-unknown', (n) => `${plural(n, 'shape')} in a form that cannot be drawn ${n === 1 ? 'is' : 'are'} drawn as ${n === 1 ? 'a rectangle' : 'rectangles'}.`);
  if (!take(env)) return;

  const kind = 'kind' in geom ? geom.kind : 'rect';
  const el: ShapeElement = { type: 'shape', shape: kind, ...placed(xf, env, stack), ...names(cNvPr) };
  if (ph) el.ph = ph;
  const adjust = kind === 'roundRect' ? ('adjust' in geom && geom.adjust !== undefined ? geom.adjust : adjustOf(spPr)) : undefined;
  if (adjust !== undefined) el.adjust = adjust;

  let fill: Fill | undefined;
  if (fillElement(spPr)) fill = readFill(spPr, pc);
  else if (ph) fill = chain.find((c) => c.fill)?.fill;
  if (!fill && !fillElement(spPr) && style) fill = readFillRef(child(style, 'a:fillRef'), pc);
  el.fill = fill ?? { kind: 'none' };
  const line = lineOf(spPr, style, chain, pc);
  if (line) el.line = line;
  if (shadowOf(spPr)) el.shadow = true;

  if (tx) {
    const colour = colorIn(child(style, 'a:fontRef'), pc.color);
    const bake = !(env.layout && ph);
    const doc = readTextBody(tx, { pc, ...(bake ? { defaults: readLevels(child(tx, 'a:lstStyle'), pc) } : {}), ...(colour && !(env.layout && ph) ? { shapeColor: colour.color } : {}) });
    if (ph || hasText(doc)) {
      el.text = doc;
      const box = finishBox(mergeBoxes(...[...chain].reverse().map((c) => c.box), readBodyPr(child(tx, 'a:bodyPr'), pc)), pc);
      if (box) el.textBox = box;
    }
  }
  out.push(el);
}

function defaultLine(pc: PartCtx): Line {
  return { color: { theme: 'dk1' }, width: toLen(pc.deck.space, 9525) };
}

// ── a picture ───────────────────────────────────────────────────────────────

function readPic(pic: XNode, env: TreeEnv, stack: readonly GroupXf[], out: ElementJSON[], frame?: RawXfrm | null): void {
  const pc = env.pc;
  const nv = child(pic, 'p:nvPicPr');
  const cNvPr = child(nv, 'p:cNvPr');
  if (hiddenIn(cNvPr)) return;
  const nvPr = child(nv, 'p:nvPr');
  const phNode = phElement(pic);
  if (phNode && env.skipPlaceholders) return;
  if (nvPr && elements(nvPr).some((c) => c.name === 'a:videoFile' || c.name === 'a:audioFile' || c.name === 'a:wavAudioFile' || c.name === 'a:quickTimeFile')) {
    pc.deck.warnings.add('media', (n) => `${plural(n, 'video or audio clip')} ${n === 1 ? 'is' : 'are'} shown as ${n === 1 ? 'its' : 'their'} picture.`);
  }
  const bf = child(pic, 'p:blipFill');
  const blip = child(bf, 'a:blip');
  const asset = relImage(pc, blip?.attrs['r:embed'] ?? blip?.attrs['r:link']);
  if (!asset) return;
  const ph = phNode ? placeholderOf(phNode) : undefined;
  const chain = ph ? env.inherit(ph) : [];
  const spPr = child(pic, 'p:spPr');
  const xf = frame ?? readXfrm(child(spPr, 'a:xfrm')) ?? chain.find((c) => c.xfrm)?.xfrm ?? null;
  if (!take(env)) return;
  const el: ImageElement = { type: 'image', ...placed(xf, env, stack), ...names(cNvPr), asset };
  if (ph) el.ph = ph;
  const src = child(bf, 'a:srcRect');
  if (src) {
    const f = (k: string): number => Math.max(0, Math.min(0.99, int(src, k, 0) / 100_000));
    const crop = { l: f('l'), t: f('t'), r: f('r'), b: f('b') };
    if ((crop.l || crop.t || crop.r || crop.b) && crop.l + crop.r < 1 && crop.t + crop.b < 1) {
      el.crop = { l: round4(crop.l), t: round4(crop.t), r: round4(crop.r), b: round4(crop.b) };
    }
  }
  const line = lineOf(spPr, null, chain, pc);
  if (line) el.line = line;
  out.push(el);
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// ── a connector ─────────────────────────────────────────────────────────────

function readCxn(cxn: XNode, env: TreeEnv, stack: readonly GroupXf[], out: ElementJSON[]): void {
  const pc = env.pc;
  const nv = child(cxn, 'p:nvCxnSpPr');
  const cNvPr = child(nv, 'p:cNvPr');
  if (hiddenIn(cNvPr)) return;
  const spPr = child(cxn, 'p:spPr');
  const geom = geometryOf(spPr);
  if ('line' in geom && geom.bent) pc.deck.warnings.add('connector-bent', bentWarning);
  if (!take(env)) return;
  const line: LineElement['line'] = lineOf(spPr, child(cxn, 'p:style'), [], pc) ?? defaultLine(pc);
  out.push({ type: 'line', ...placed(readXfrm(child(spPr, 'a:xfrm')), env, stack), ...names(cNvPr), line });
}

// ── a group ─────────────────────────────────────────────────────────────────

function readGroup(grp: XNode, env: TreeEnv, stack: readonly GroupXf[], depth: number, out: ElementJSON[]): void {
  const nv = child(grp, 'p:nvGrpSpPr');
  const cNvPr = child(nv, 'p:cNvPr');
  if (hiddenIn(cNvPr)) return;
  const gx = readGroupXf(child(child(grp, 'p:grpSpPr'), 'a:xfrm'));
  const inner = gx ? [gx, ...stack] : stack;
  if (depth + 1 > DECK_LIMITS.groupDepth) {
    env.pc.deck.warnings.add('group-depth', (n) => `${plural(n, 'group')} nested more than ${DECK_LIMITS.groupDepth} deep ${n === 1 ? 'was' : 'were'} flattened.`);
    readTree(grp, env, inner, depth + 1, out);
    return;
  }
  if (!take(env)) return;
  const kids: ElementJSON[] = [];
  readTree(grp, env, inner, depth + 1, kids);
  if (kids.length === 0) {
    env.budget.read--;
    return;
  }
  let box: Placed;
  if (gx) box = placed({ x: gx.x, y: gx.y, w: gx.w, h: gx.h, rot: gx.rot, flipH: gx.flipH, flipV: gx.flipV }, env, stack);
  else box = boundsOf(kids);
  const el: GroupElement = { type: 'group', ...box, ...names(cNvPr), children: kids };
  out.push(el);
}

function boundsOf(els: readonly ElementJSON[]): Placed {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of els) {
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w);
    y1 = Math.max(y1, e.y + e.h);
  }
  return { x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
}

// ── a graphic frame ─────────────────────────────────────────────────────────

/** The drawing SmartArt cached beside its data: found from the data model, else the slide's only one. */
function diagramDrawing(gd: XNode, pc: PartCtx): string | null {
  const relIds = child(gd, 'dgm:relIds');
  const dm = relTarget(pc, relIds?.attrs['r:dm']);
  if (dm) {
    const model = pc.deck.pkg.tryXml(dm);
    const ext = model ? descendants(model, 'p:dataModelExt')[0] : undefined;
    const via = ext ? relTarget(pc, ext.attrs.relId) : null;
    if (via) return via;
  }
  const only = [...pc.rels.values()].filter((r) => r.type === 'diagramDrawing' && !r.external);
  return only.length === 1 ? pc.deck.pkg.target(pc.part, only[0]) : null;
}

function readFrame(gf: XNode, env: TreeEnv, stack: readonly GroupXf[], depth: number, out: ElementJSON[]): void {
  const pc = env.pc;
  const nv = child(gf, 'p:nvGraphicFramePr');
  const cNvPr = child(nv, 'p:cNvPr');
  if (hiddenIn(cNvPr)) return;
  const xf = readXfrm(child(gf, 'p:xfrm'));
  const gd = child(child(gf, 'a:graphic'), 'a:graphicData');
  const uri = gd?.attrs.uri ?? '';
  if (!gd) return;
  const ph = phElement(gf);
  const chain = ph ? env.inherit(placeholderOf(ph)) : [];
  const frame = xf ?? chain.find((c) => c.xfrm)?.xfrm ?? null;

  if (uri.endsWith('/table')) {
    const parts = readTable(child(gd, 'a:tbl') ?? gd, pc);
    if (!parts || !take(env)) return;
    const box = placed(frame, env, stack);
    const w = round2(parts.cols.reduce((a, b) => a + b, 0));
    const h = round2(parts.rows.reduce((a, r) => a + r.h, 0));
    const el: TableElement = { type: 'table', ...box, w, h, ...names(cNvPr), ...parts };
    out.push(el);
    return;
  }
  if (uri.endsWith('/chart')) {
    const id = child(gd, 'c:chart')?.attrs['r:id'];
    const part = relTarget(pc, id);
    const root = part ? pc.deck.pkg.tryXml(part) : null;
    const parts = root && part ? readChart(root, enter(pc, part)) : null;
    if (!parts) {
      if (root) return;
      pc.deck.warnings.add('chart-missing', (n) => `${plural(n, 'chart')} could not be read and ${n === 1 ? 'was' : 'were'} left out.`);
      return;
    }
    if (!take(env)) return;
    out.push({ type: 'chart', ...placed(frame, env, stack), ...names(cNvPr), ...parts });
    return;
  }
  if (uri.endsWith('/diagram')) {
    const part = diagramDrawing(gd, pc);
    const root = part ? pc.deck.pkg.tryXml(part) : null;
    const tree = child(root, 'p:spTree');
    if (!part || !tree || !frame) {
      pc.deck.warnings.add('smartart', (n) => `${plural(n, 'SmartArt graphic')} had no saved drawing and ${n === 1 ? 'was' : 'were'} left out.`);
      return;
    }
    // The drawing is laid out from the frame's own corner, at the frame's own scale.
    const g: GroupXf = { x: frame.x, y: frame.y, w: frame.w, h: frame.h, chX: 0, chY: 0, chW: frame.w, chH: frame.h, rot: frame.rot, flipH: frame.flipH, flipV: frame.flipV };
    if (!take(env)) return;
    const kids: ElementJSON[] = [];
    readTree(tree, { ...env, pc: enter(pc, part) }, [g, ...stack], depth + 1, kids);
    if (kids.length === 0) {
      env.budget.read--;
      return;
    }
    out.push({ type: 'group', ...placed(frame, env, stack), ...names(cNvPr), name: names(cNvPr).name ?? 'Diagram', children: kids });
    return;
  }
  // An OLE object or anything else that carries a picture of itself.
  for (const pic of descendants(gd, 'p:pic')) {
    const before = out.length;
    readPic(pic, env, stack, out, frame);
    if (out.length > before) return;
  }
  pc.deck.warnings.add('object', (n) => `${plural(n, 'embedded object')} had no picture to show and ${n === 1 ? 'was' : 'were'} left out.`);
}

// ── the tree ────────────────────────────────────────────────────────────────

export function readTree(tree: XNode, env: TreeEnv, stack: readonly GroupXf[], depth: number, out: ElementJSON[]): void {
  for (const c of elements(tree)) {
    switch (c.name) {
      case 'p:sp':
        readSp(c, env, stack, out);
        break;
      case 'p:pic':
        readPic(c, env, stack, out);
        break;
      case 'p:cxnSp':
        readCxn(c, env, stack, out);
        break;
      case 'p:grpSp':
        readGroup(c, env, stack, depth, out);
        break;
      case 'p:graphicFrame':
        readFrame(c, env, stack, depth, out);
        break;
      case 'mc:AlternateContent': {
        const b = branch(c);
        if (b) readTree(b, env, stack, depth, out);
        break;
      }
      default:
        break;
    }
  }
}

/** Says once how many elements were left out for being past the slide's limit. */
export function reportBudget(env: TreeEnv): void {
  if (env.budget.refused > 0) {
    env.pc.deck.warnings.add('elements-limit', (n) => `${plural(n, 'shape')} past the ${DECK_LIMITS.elementsPerSlide} a slide can hold ${n === 1 ? 'was' : 'were'} left out.`, env.budget.refused);
    env.budget.refused = 0;
  }
}
