/**
 * A slide: its background, its elements, its transition, its notes and whether it is hidden.
 */

import type { ElementJSON, SlideJSON, TextDoc, Transition } from '../../slides/model/deck';
import { plural } from '../types';
import { child, elements, type XNode } from '../xml';
import { clrMapOf, readBackground, type LayoutInfo } from './masters';
import { enter, type PartCtx } from './ctx';
import { chainFor, phElement } from './inherit';
import { reportBudget, readTree, type TreeEnv } from './shapes';
import { flag, pick } from './part';
import { hasText, readTextBody } from './text';

// ── transitions ─────────────────────────────────────────────────────────────

type Kind = Transition['kind'];

/** Every transition PowerPoint has, as the nearest of the deck's five. */
const KINDS: Record<string, Kind> = {
  'p:fade': 'fade',
  'p:dissolve': 'fade',
  'p:random': 'fade',
  'p:newsflash': 'zoom',
  'p:push': 'push',
  'p:cover': 'push',
  'p:pull': 'push',
  'p:wipe': 'wipe',
  'p:split': 'wipe',
  'p:blinds': 'wipe',
  'p:checker': 'wipe',
  'p:comb': 'wipe',
  'p:strips': 'wipe',
  'p:randomBar': 'wipe',
  'p:zoom': 'zoom',
  'p:circle': 'zoom',
  'p:diamond': 'zoom',
  'p:plus': 'zoom',
  'p:wedge': 'zoom',
  'p:wheel': 'zoom',
  'p:cut': 'none',
  'p14:pan': 'push',
  'p14:reveal': 'wipe',
  'p14:vortex': 'fade',
  'p14:switch': 'fade',
  'p14:flip': 'fade',
  'p14:ripple': 'fade',
  'p14:honeycomb': 'fade',
  'p14:prism': 'fade',
  'p14:doors': 'fade',
  'p14:window': 'fade',
  'p14:ferris': 'fade',
  'p14:gallery': 'fade',
  'p14:conveyor': 'fade',
  'p14:glitter': 'fade',
  'p14:warp': 'zoom',
  'p14:flythrough': 'zoom',
  'p14:flash': 'fade',
  'p14:shred': 'fade',
  'p14:wheelReverse': 'zoom'
};

/** `dir` names where the motion goes; the deck names the side the new slide comes from. */
const FROM: Record<string, NonNullable<Transition['from']>> = { l: 'right', r: 'left', u: 'bottom', d: 'top' };

const SPEED: Record<string, number> = { fast: 500, med: 750, slow: 1000 };

function transitionNode(sld: XNode): XNode | null {
  const direct = child(sld, 'p:transition');
  if (direct) return direct;
  const ac = child(sld, 'mc:AlternateContent');
  if (!ac) return null;
  return child(child(ac, 'mc:Choice'), 'p:transition') ?? child(child(ac, 'mc:Fallback'), 'p:transition');
}

export function readTransition(sld: XNode): Transition | undefined {
  const t = transitionNode(sld);
  if (!t) return undefined;
  const effect = elements(t).find((c) => pick(KINDS, c.name) !== undefined);
  const kind: Kind = effect ? pick(KINDS, effect.name)! : 'none';
  const out: Transition = { kind };
  const dur = Number(t.attrs['p14:dur']);
  if (kind === 'none') return out;
  if (Number.isFinite(dur) && dur > 0) out.duration = Math.min(60_000, Math.round(dur));
  else if (pick(SPEED, t.attrs.spd) !== undefined) out.duration = pick(SPEED, t.attrs.spd)!;
  const from = effect ? pick(FROM, effect.attrs.dir) : undefined;
  if (from && (kind === 'push' || kind === 'wipe')) out.from = from;
  return out;
}

// ── notes ───────────────────────────────────────────────────────────────────

function readNotes(pc: PartCtx): TextDoc | undefined {
  const rel = [...pc.rels.values()].find((r) => r.type === 'notesSlide' && !r.external);
  const part = rel ? pc.deck.pkg.target(pc.part, rel) : null;
  const root = part ? pc.deck.pkg.tryXml(part) : null;
  const tree = child(child(root, 'p:cSld'), 'p:spTree');
  if (!part || !tree) return undefined;
  const npc = enter(pc, part);
  for (const sp of elements(tree)) {
    if (sp.name !== 'p:sp') continue;
    const ph = phElement(sp);
    if (!ph || (ph.attrs.type !== 'body' && !(ph.attrs.type === undefined && ph.attrs.idx === '1'))) continue;
    const doc = readTextBody(child(sp, 'p:txBody'), { pc: npc });
    return hasText(doc) ? doc : undefined;
  }
  return undefined;
}

// ── a slide ─────────────────────────────────────────────────────────────────

export function readSlide(root: XNode, part: string, layout: LayoutInfo): SlideJSON {
  const deck = layout.pc.deck;
  const rels = deck.pkg.rels(part);
  const override = child(child(root, 'p:clrMapOvr'), 'a:overrideClrMapping');
  const pc: PartCtx = { ...layout.pc, part, rels, color: { ...layout.pc.color, map: clrMapOf(override, layout.pc.color.map) } };
  const cSld = child(root, 'p:cSld');
  const tree = child(cSld, 'p:spTree');
  const els: ElementJSON[] = [];
  if (tree) {
    const env: TreeEnv = { pc, inherit: chainFor(layout.phs, layout.master.phs), budget: { read: 0, refused: 0 } };
    readTree(tree, env, [], 0, els);
    reportBudget(env);
  }
  const out: SlideJSON = { layout: layout.json.id, elements: els };
  if (child(root, 'p:timing')) deck.warnings.add('animations', (n) => `${plural(n, 'slide')} with animations ${n === 1 ? 'was' : 'were'} read without them.`);
  if ([...rels.values()].some((r) => /^(?:comments|modernComment)$/.test(r.type))) deck.warnings.add('comments', (n) => `${plural(n, 'slide')} with comments ${n === 1 ? 'was' : 'were'} read without them.`);
  const bg = readBackground(cSld, pc);
  if (bg) out.bg = bg;
  if (flag(root, 'show') === false) out.hidden = true;
  if (root.attrs.showMasterSp === '0' || root.attrs.showMasterSp === 'false') out.showMaster = false;
  const transition = readTransition(root);
  if (transition) out.transition = transition;
  const notes = readNotes(pc);
  if (notes) out.notes = notes;
  return out;
}

/** A slide that could not be read: it is still a slide, on its layout, with nothing on it. */
export const blankSlide = (layout: string): SlideJSON => ({ layout, elements: [] });

