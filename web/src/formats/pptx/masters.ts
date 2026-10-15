/**
 * Slide masters and layouts: the design a deck's slides sit on.
 *
 * A master is read into the deck's one `MasterJSON`: its background, its decorations (the shapes
 * that are not placeholders), and the text styles of its title, body and other text. Its
 * placeholders are not elements of the master; they are what the layouts' and slides' placeholders
 * inherit their place and text box from (`inherit.ts`). A layout is a `LayoutJSON`: its
 * placeholders with their places resolved and their prompts, its decorations, and the text styles
 * its placeholders state.
 *
 * The deck has one master and one theme. A presentation with more (a corporate template with
 * a second master for dividers) keeps the master its first slide uses; the layouts of the others
 * that slides use are folded into it, carrying the master's background, decorations and text
 * styles with them, and their colours are baked so the first theme does not recolour them.
 */

import type { Fill, LayoutJSON, MasterJSON, PlaceholderType, TextStyle } from '../../slides/model/deck';
import { child, elements, type XNode } from '../xml';
import { IDENTITY_MAP, type ClrMap, type SlotName } from './color';
import { relTarget, type DeckCtx, type PartCtx } from './ctx';
import { readFill, readFillRef } from './fill';
import { layoutChain, NO_INHERIT, placeholdersIn, type PhSource } from './inherit';
import { reportBudget, readTree, type TreeEnv } from './shapes';
import { parseTheme, sameTheme, type ParsedTheme } from './theme';
import { readLevel, readLevels } from './text';

export interface MasterInfo {
  part: string;
  pc: PartCtx;
  theme: ParsedTheme;
  phs: PhSource[];
  json: MasterJSON;
}

export interface LayoutInfo {
  part: string;
  master: MasterInfo;
  /** Its placeholders, as the slides on it inherit from them. */
  phs: PhSource[];
  json: LayoutJSON;
  pc: PartCtx;
}

const SLOTS: readonly string[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/** `p:clrMap` or `a:overrideClrMapping`: which slot each of bg1, tx1, bg2 and tx2 is. */
export function clrMapOf(n: XNode | null | undefined, base: ClrMap = IDENTITY_MAP): ClrMap {
  if (!n) return base;
  const pick = (k: keyof ClrMap): SlotName => {
    const v = n.attrs[k];
    return v && SLOTS.includes(v) ? (v as SlotName) : base[k];
  };
  return { bg1: pick('bg1'), tx1: pick('tx1'), bg2: pick('bg2'), tx2: pick('tx2') };
}

/** A part's background: `bgPr` states a fill, `bgRef` points at the theme's. */
export function readBackground(cSld: XNode | null | undefined, pc: PartCtx): Fill | undefined {
  const bg = child(cSld, 'p:bg');
  if (!bg) return undefined;
  const pr = child(bg, 'p:bgPr');
  if (pr) return readFill(pr, pc);
  return readFillRef(child(bg, 'p:bgRef'), pc, true);
}

const merge = (a: TextStyle | undefined, b: TextStyle | undefined): TextStyle => ({ ...a, ...b });

function mergeLevels(a: readonly TextStyle[], b: readonly TextStyle[]): TextStyle[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => merge(a[i], b[i]));
}

/**
 * Reads a master. `primary` is the deck's theme once it is known: a master whose theme differs
 * has its colours baked. `defaults` is the presentation's `defaultTextStyle`, the base of the
 * "other" text style.
 */
export function readMaster(deck: DeckCtx, part: string | null, primary: ParsedTheme | null, defaults: XNode | null): MasterInfo {
  const root = part ? deck.pkg.tryXml(part) : null;
  const rels = part ? deck.pkg.rels(part) : new Map();
  const themeRel = [...rels.values()].find((r) => r.type === 'theme');
  const themePart = part && themeRel ? deck.pkg.target(part, themeRel) : null;
  const theme = parseTheme(themePart ? deck.pkg.tryXml(themePart) : null);
  const map = clrMapOf(child(root, 'p:clrMap'));
  const pc: PartCtx = { deck, part: part ?? '', rels, theme, color: { hex: theme.hex, map, bake: primary !== null && !sameTheme(theme, primary) } };

  const cSld = child(root, 'p:cSld');
  const tree = child(cSld, 'p:spTree');
  const phs = tree ? placeholdersIn(tree, pc) : [];
  const elementsOut: MasterJSON['elements'] = [];
  if (tree) {
    const env: TreeEnv = { pc, inherit: NO_INHERIT, skipPlaceholders: true, budget: { read: 0, refused: 0 } };
    readTree(tree, env, [], 0, elementsOut);
    reportBudget(env);
  }

  const tx = child(root, 'p:txStyles');
  const titlePh = phs.find((p) => p.ph.type === 'title');
  const bodyPh = phs.find((p) => p.ph.type === 'body');
  const title = merge(readLevel(child(child(tx, 'p:titleStyle'), 'a:lvl1pPr'), pc), titlePh?.levels[0]);
  const body = mergeLevels(readLevels(child(tx, 'p:bodyStyle'), pc), bodyPh?.levels ?? []);
  const other = merge(readLevel(child(defaults, 'a:lvl1pPr'), pc), readLevel(child(child(tx, 'p:otherStyle'), 'a:lvl1pPr'), pc));

  const bg = readBackground(cSld, pc);
  const json: MasterJSON = { ...(bg ? { bg } : {}), elements: elementsOut, styles: { title, body, other } };
  return { part: part ?? '', pc, theme, phs, json };
}

/** The layout parts of a master, in the order its `sldLayoutIdLst` lists them. */
export function layoutPartsOf(master: MasterInfo): string[] {
  const root = master.part ? master.pc.deck.pkg.tryXml(master.part) : null;
  const out: string[] = [];
  const list = child(root, 'p:sldLayoutIdLst');
  for (const id of list ? elements(list) : []) {
    if (id.name !== 'p:sldLayoutId') continue;
    const target = relTarget(master.pc, id.attrs['r:id']);
    if (target && !out.includes(target)) out.push(target);
  }
  return out;
}

const STYLE_TYPES: PlaceholderType[] = ['title', 'ctrTitle', 'subTitle', 'body', 'pic', 'dt', 'ftr', 'sldNum'];

/** Reads a layout against its master. `id` is the deck's name for it. */
export function readLayout(master: MasterInfo, part: string, id: string, fold: boolean): LayoutInfo | null {
  const deck = master.pc.deck;
  const root = deck.pkg.tryXml(part);
  if (!root || root.name !== 'p:sldLayout') return null;
  const rels = deck.pkg.rels(part);
  const override = child(child(root, 'p:clrMapOvr'), 'a:overrideClrMapping');
  const pc: PartCtx = { ...master.pc, part, rels, color: { ...master.pc.color, map: clrMapOf(override, master.pc.color.map) } };
  const cSld = child(root, 'p:cSld');
  const tree = child(cSld, 'p:spTree');
  const phs = tree ? placeholdersIn(tree, pc) : [];
  const own: LayoutJSON['elements'] = [];
  if (tree) {
    const env: TreeEnv = { pc, inherit: layoutChain(master.phs), layout: true, budget: { read: 0, refused: 0 } };
    readTree(tree, env, [], 0, own);
    reportBudget(env);
  }
  const name = (cSld?.attrs.name || root.attrs.matchingName || root.attrs.type || 'Layout').trim().slice(0, 80) || 'Layout';
  const showMaster = root.attrs.showMasterSp !== '0' && root.attrs.showMasterSp !== 'false';
  let bg = readBackground(cSld, pc);

  const styles: NonNullable<LayoutJSON['styles']> = {};
  for (const type of STYLE_TYPES) {
    const src = phs.find((p) => p.ph.type === type && p.levels.length > 0);
    if (src) styles[type] = src.levels;
  }
  let elementsOut = own;
  let showsMaster: boolean | undefined = showMaster ? undefined : false;

  if (fold) {
    // This layout's master is not the deck's: carry what the master gave it.
    const m = master.json;
    bg ??= m.bg;
    if (showMaster) elementsOut = [...m.elements, ...own];
    showsMaster = false;
    const fromMaster: Partial<Record<PlaceholderType, TextStyle[]>> = {
      title: [m.styles.title],
      ctrTitle: [m.styles.title],
      body: m.styles.body,
      subTitle: m.styles.body
    };
    for (const type of ['title', 'ctrTitle', 'body', 'subTitle'] as const) {
      const base = fromMaster[type]!;
      const stated = styles[type] ?? [];
      const folded = mergeLevels(base, stated);
      if (folded.length > 0) styles[type] = folded;
    }
  }
  const json: LayoutJSON = {
    id,
    name,
    ...(bg ? { bg } : {}),
    ...(showsMaster === false ? { showMaster: false } : {}),
    elements: elementsOut,
    ...(Object.keys(styles).length > 0 ? { styles } : {})
  };
  return { part, master, phs, json, pc };
}
