/**
 * pptx to a Slides deck.
 *
 * The reader is ours (fflate and saxes, no DOM) and produces `DeckJSON` (slides/model/deck.ts)
 * directly. It reads what the deck can hold, and says once what it left out:
 *
 *   the deck        the slide size (scaled to 1920 wide), the theme's colours and fonts, one master
 *                   with its background, decorations and text styles, every layout with its
 *                   placeholders resolved, and every slide in `sldIdLst` order, hidden ones too
 *   a slide         shapes, text boxes, placeholders, pictures with their crop, lines and
 *                   connectors, groups, tables with merges, charts (the values they cached),
 *                   SmartArt and OLE objects (the picture they saved), notes, the transition,
 *                   the background
 *   not read        animations, comments, sections, custom paths, table styles, embedded fonts,
 *                   video and audio (their poster frame is kept), anything in a macro
 *
 * ── Untrusted input ─────────────────────────────────────────────────────────
 * The same rules as the docx and xlsx readers. The zip's directory is counted before anything is
 * inflated; no part has a DOCTYPE or an entity; no address goes in, and every link that comes out
 * is http, https or mailto; a picture is what its bytes say, PNG, JPEG, GIF or WebP, and a
 * relationship that points outside the file is data that is never followed. Every number is
 * clamped, so a slide 9e15 EMU wide is a slide with a shape at the edge. Nothing is fetched.
 *
 * A slide that cannot be read is still a slide: it is blank, on its layout, and the warnings say so.
 */

import { DECK_LIMITS, type DeckJSON, type LayoutJSON } from '../../slides/model/deck';
import { FormatError } from '../errors';
import { MAX_FILE_BYTES } from '../limits';
import { plural, Warnings, type Warning } from '../types';
import { child, elements } from '../xml';
import { ImageStore, type DeckCtx } from './ctx';
import { layoutPartsOf, readLayout, readMaster, type LayoutInfo, type MasterInfo } from './masters';
import { PptxPackage } from './package';
import { int } from './part';
import { blankSlide, readSlide } from './slide';
import { spaceFor, spaceOf } from './units';

export interface PptxImport {
  deck: DeckJSON;
  /** What was left out or changed, as sentences. */
  warnings: string[];
  /** The same, with a code and a count for each kind. */
  details: Warning[];
  /** `dc:title` of the file, if it has one. */
  title: string | null;
}

const layoutOf = (pkg: PptxPackage, slidePart: string): string | null => {
  const rel = [...pkg.rels(slidePart).values()].find((r) => r.type === 'slideLayout' && !r.external);
  return rel ? pkg.target(slidePart, rel) : null;
};

const masterOf = (pkg: PptxPackage, layoutPart: string): string | null => {
  const rel = [...pkg.rels(layoutPart).values()].find((r) => r.type === 'slideMaster' && !r.external);
  return rel ? pkg.target(layoutPart, rel) : null;
};

export function readPptx(bytes: Uint8Array): PptxImport {
  if (bytes.length === 0) throw new FormatError('empty');
  if (bytes.length > MAX_FILE_BYTES) throw new FormatError('too_large', `${bytes.length} bytes`);
  const pkg = PptxPackage.open(bytes);
  const mainPath = pkg.mainPart();
  const pres = pkg.xml(mainPath);
  if (!pres || pres.name !== 'p:presentation') throw new FormatError('not_pptx', 'the main part is not a presentation');

  const warnings = new Warnings();
  const sz = child(pres, 'p:sldSz');
  let space = spaceOf(int(sz, 'cx', 0), int(sz, 'cy', 0));
  if (!space) {
    warnings.add('size', () => 'The slide size was not a size a slide can be, so the slide is 16:9.');
    space = spaceFor('16:9');
  }
  const deck: DeckCtx = { pkg, space, warnings, images: new ImageStore(pkg, warnings), chars: 0 };

  // ── the slides, in order ──────────────────────────────────────────────────
  const presRels = pkg.rels(mainPath);
  const list = child(pres, 'p:sldIdLst');
  const refs = (list ? elements(list) : []).filter((e) => e.name === 'p:sldId');
  if (refs.length > DECK_LIMITS.slides) throw new FormatError('deck_too_large', `${refs.length} slides`);
  const slideParts = refs.map((r) => pkg.target(mainPath, presRels.get(r.attrs['r:id'] ?? '')));
  const layoutParts = slideParts.map((p) => (p ? layoutOf(pkg, p) : null));

  // ── the master the deck keeps ─────────────────────────────────────────────
  const firstUsed = layoutParts.map((l) => (l ? masterOf(pkg, l) : null)).find((m): m is string => !!m);
  const listedMaster = (() => {
    const l = child(pres, 'p:sldMasterIdLst');
    const first = l ? elements(l).find((e) => e.name === 'p:sldMasterId') : undefined;
    return first ? pkg.target(mainPath, presRels.get(first.attrs['r:id'] ?? '')) : null;
  })();
  const primaryPart = firstUsed ?? listedMaster;
  const defaults = child(pres, 'p:defaultTextStyle');
  const primary = readMaster(deck, primaryPart, null, defaults);
  const masters = new Map<string, MasterInfo>([[primaryPart ?? '', primary]]);

  // ── the layouts: all of the primary master's, and those the slides use from others ──
  const layouts = new Map<string, LayoutInfo>();
  const add = (master: MasterInfo, part: string): LayoutInfo | null => {
    const known = layouts.get(part);
    if (known) return known;
    const info = readLayout(master, part, `l${layouts.size + 1}`, master !== primary);
    if (info) layouts.set(part, info);
    return info;
  };
  for (const part of layoutPartsOf(primary)) add(primary, part);
  for (const part of layoutParts) {
    if (!part || layouts.has(part)) continue;
    const mp = masterOf(pkg, part) ?? primaryPart ?? '';
    let master = masters.get(mp);
    if (!master) {
      master = readMaster(deck, mp || null, primary.theme, defaults);
      masters.set(mp, master);
    }
    add(master, part);
  }
  if (layouts.size === 0) {
    const json: LayoutJSON = { id: 'l1', name: 'Blank', elements: [] };
    layouts.set('', { part: '', master: primary, phs: [], json, pc: primary.pc });
  }
  const fallback = [...layouts.values()][0]!;

  // ── the slides ────────────────────────────────────────────────────────────
  const slides = slideParts.map((part, i) => {
    const layout = (layoutParts[i] ? layouts.get(layoutParts[i]!) : undefined) ?? fallback;
    const root = part ? pkg.tryXml(part) : null;
    if (!part || !root || root.name !== 'p:sld') {
      warnings.add('slide-unreadable', (n) => `${plural(n, 'slide')} could not be read and ${n === 1 ? 'is' : 'are'} blank.`);
      return blankSlide(layout.json.id);
    }
    return readSlide(root, part, layout);
  });
  if (slides.length === 0) warnings.add('no-slides', () => 'The presentation has no slides.');

  const details = warnings.list();
  const out: DeckJSON = {
    v: 1,
    size: space.aspect,
    theme: primary.theme.json,
    master: primary.json,
    layouts: [...layouts.values()].map((l) => l.json),
    slides
  };
  return { deck: out, warnings: details.map((w) => w.message), details, title: pkg.coreTitle() };
}

