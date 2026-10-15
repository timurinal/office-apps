/**
 * Placeholders: what a slide's placeholder takes from its layout, and the layout's from the master.
 *
 * A placeholder on a slide usually states little: its text, and often no position at all. Its
 * position, its text box (anchor, insets, autofit), its fill and its line come from the
 * placeholder it matches on the layout, and that one's from the master's. The deck stores each
 * element with its own geometry, so the reader resolves the chain here and writes the result onto
 * the element. Text styles are not resolved: the deck inherits those itself (`LayoutJSON.styles`,
 * `MasterJSON.styles`), so the reader hands over what each layer states.
 *
 * Matching is PowerPoint's: by `idx` when the slide's placeholder has one the layout also has,
 * otherwise by type, where title and ctrTitle are one kind and every content-like type (body,
 * object, picture, chart, table, subtitle) another.
 */

import type { Fill, Line, Placeholder, PlaceholderType, TextStyle } from '../../slides/model/deck';
import { child, elements, type XNode } from '../xml';
import { fillElement, readFill, readLine } from './fill';
import type { PartCtx } from './ctx';
import { readXfrm, type RawXfrm } from './geometry';
import { int, pick } from './part';
import { readBodyPr, readLevels, type BoxParts } from './text';

const TYPES: Record<string, PlaceholderType> = {
  title: 'title',
  ctrTitle: 'ctrTitle',
  subTitle: 'subTitle',
  body: 'body',
  pic: 'pic',
  dt: 'dt',
  ftr: 'ftr',
  sldNum: 'sldNum'
};

/** A placeholder as the deck names it. `obj` (no type), chart, table, media and the rest are content: `body`. */
export function placeholderOf(ph: XNode): Placeholder {
  const type = pick(TYPES, ph.attrs.type) ?? 'body';
  const idx = ph.attrs.idx !== undefined ? int(ph, 'idx', NaN) : NaN;
  return Number.isFinite(idx) ? { type, idx } : { type };
}

/** What a layer states about one placeholder. */
export interface PhSource {
  ph: Placeholder;
  xfrm: RawXfrm | null;
  box: BoxParts;
  fill?: Fill;
  line?: Line;
  /** Its `lstStyle`, by level. */
  levels: TextStyle[];
}

type Kind = 'title' | 'body' | 'dt' | 'ftr' | 'sldNum';

const kindOf = (t: PlaceholderType): Kind => (t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : 'body');

/** The `p:ph` element of a shape, if it is a placeholder. */
export function phElement(shape: XNode): XNode | null {
  for (const nv of ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr', 'p:nvCxnSpPr']) {
    const ph = child(child(child(shape, nv), 'p:nvPr'), 'p:ph');
    if (ph) return ph;
  }
  return null;
}

/** What one layer says about a placeholder shape. */
export function sourceOf(shape: XNode, ph: XNode, pc: PartCtx): PhSource {
  const spPr = child(shape, 'p:spPr');
  const tx = child(shape, 'p:txBody');
  const own = fillElement(spPr) ? readFill(spPr, pc) : undefined;
  const ln = child(spPr, 'a:ln');
  const line = ln ? readLine(ln, pc) : undefined;
  return {
    ph: placeholderOf(ph),
    xfrm: readXfrm(child(spPr, 'a:xfrm')),
    box: readBodyPr(child(tx, 'a:bodyPr'), pc),
    ...(own ? { fill: own } : {}),
    ...(line ? { line } : {}),
    levels: readLevels(child(tx, 'a:lstStyle'), pc)
  };
}

/** Every placeholder shape directly in a shape tree (looking through `mc:AlternateContent`). */
export function placeholdersIn(tree: XNode, pc: PartCtx): PhSource[] {
  const out: PhSource[] = [];
  const visit = (n: XNode): void => {
    for (const c of elements(n)) {
      if (c.name === 'mc:AlternateContent') {
        const choice = child(c, 'mc:Choice') ?? child(c, 'mc:Fallback');
        if (choice) visit(choice);
        continue;
      }
      if (c.name !== 'p:sp' && c.name !== 'p:pic' && c.name !== 'p:graphicFrame') continue;
      const ph = phElement(c);
      if (ph) out.push(sourceOf(c, ph, pc));
    }
  };
  visit(tree);
  return out;
}

/** The placeholder a slide's (or layout's) placeholder inherits from, among `layer`. */
export function matchIn(layer: readonly PhSource[], ph: Placeholder, byIdx: boolean): PhSource | undefined {
  if (byIdx && ph.idx !== undefined) {
    const same = layer.filter((p) => p.ph.idx === ph.idx);
    const exact = same.find((p) => p.ph.type === ph.type) ?? same.find((p) => kindOf(p.ph.type) === kindOf(ph.type));
    if (exact) return exact;
    // A title has no idx on one side and 0 on the other.
    if (kindOf(ph.type) !== 'title' && same[0]) return same[0];
  }
  return layer.find((p) => p.ph.type === ph.type) ?? layer.find((p) => kindOf(p.ph.type) === kindOf(ph.type));
}

/**
 * The layers above a part, most specific first: for a slide, its layout's placeholder then the
 * master's; for a layout, the master's.
 */
export type Inherit = (ph: Placeholder) => PhSource[];

export const NO_INHERIT: Inherit = () => [];

/** A slide's chain from its layout's and its master's placeholders. */
export function chainFor(layout: readonly PhSource[], master: readonly PhSource[]): Inherit {
  return (ph) => {
    const l = matchIn(layout, ph, true);
    const m = matchIn(master, l?.ph ?? ph, false);
    return [l, m].filter((x): x is PhSource => !!x);
  };
}

/** A layout's chain: the master's placeholder of its kind. */
export function layoutChain(master: readonly PhSource[]): Inherit {
  return (ph) => {
    const m = matchIn(master, ph, false);
    return m ? [m] : [];
  };
}
