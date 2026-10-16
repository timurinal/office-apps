/**
 * A Slides deck to pptx.
 *
 * The writer is ours (fflate, no DOM): it writes the OOXML a deck maps onto, rather than
 * running the deck through a library that has its own idea of a master. What it keeps:
 *
 *   the design      the theme (twelve colours, two fonts, as a real theme part), one master with
 *                   its background, decorations and text styles, and every layout with its
 *                   placeholders, prompts and text styles, so PowerPoint's Layout menu and a
 *                   re-import find what the deck had
 *   a slide         its layout, background, hidden flag, transition, notes, and its elements back
 *                   to front: shapes, text boxes, placeholders (with the idx of the layout's),
 *                   pictures with their crop, lines, groups, tables with merges, and charts with
 *                   the workbook behind them
 *   colour          a theme colour is written as `schemeClr` with its tint, never as the hex it
 *                   resolves to, so the file follows its theme
 *
 * Pictures arrive through `getAsset`, because the writer has no network and does not know where a
 * document keeps its assets. A picture it cannot get, or that is not PNG, JPEG, GIF or WebP, is left
 * out and counted. The output is deterministic: the same deck is the same bytes.
 */

import { zipSync, type Zippable } from 'fflate';
import type { AssetRef, DeckJSON, ElementJSON, Fill, LayoutJSON, SlideJSON } from '../../slides/model/deck';
import { assetMimeOf, imageSize } from '../images';
import { plural, Warnings, type Warning } from '../types';
import { appXml, coreXml, CT, layoutXml, masterXml, notesMasterXml, notesSlideXml, presentationXml, PRES_PROPS, safeTheme, slideXml, TABLE_STYLES, themeXml, VIEW_PROPS } from './writeDeck';
import { chartPartXml, chartWorkbook } from './writeChart';
import type { ChartData, MediaRef, PartOut, PhPlan } from './writeShapes';
import { hasText } from './text';
import { spaceFor, type Space } from './units';
import { el, list, obj, Rels, XML_DECL } from './xmlOut';

export interface AssetBytes {
  bytes: Uint8Array;
  mime: string;
}

export interface PptxWriteOptions {
  /** The file's title, for the document properties. */
  title?: string;
  /** Unix milliseconds for the document properties. Defaults to a fixed date, so the same deck is the same file. */
  now?: number;
}

export interface PptxWriteResult {
  bytes: Uint8Array;
  warnings: Warning[];
}

type GetAsset = (ref: AssetRef) => Promise<AssetBytes | null>;

// ── pictures ────────────────────────────────────────────────────────────────

interface Media {
  path: string;
  bytes: Uint8Array;
  ext: string;
  width?: number;
  height?: number;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' };

function decodeBase64(data: string): Uint8Array | null {
  try {
    const bin = atob(data.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function fingerprint(b: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i]!, 0x01000193);
    h2 = (Math.imul(h2, 33) + b[i]!) | 0;
  }
  return `${b.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Every picture the deck refers to, once each, by the object that refers to it. */
function assetsOf(deck: DeckJSON): AssetRef[] {
  const out = new Set<AssetRef>();
  const fill = (f: Fill | undefined): void => {
    if (f && typeof f === 'object' && f.kind === 'image' && obj(f.asset)) out.add(f.asset);
  };
  const walk = (e: ElementJSON): void => {
    if (!e || typeof e !== 'object') return;
    switch (e.type) {
      case 'image':
        if (obj(e.asset)) out.add(e.asset);
        break;
      case 'shape':
        fill(e.fill);
        break;
      case 'table':
        for (const r of list<{ cells?: unknown }>(e.rows)) for (const c of list<{ fill?: Fill }>(obj<{ cells?: unknown }>(r)?.cells)) fill(obj<{ fill?: Fill }>(c)?.fill);
        break;
      case 'group':
        list<ElementJSON>(e.children).forEach(walk);
        break;
      default:
        break;
    }
  };
  fill(deck.master?.bg);
  list<ElementJSON>(deck.master?.elements).forEach(walk);
  for (const l of list<LayoutJSON>(deck.layouts)) {
    if (!obj(l)) continue;
    fill(l.bg);
    list<ElementJSON>(l.elements).forEach(walk);
  }
  for (const s of list<SlideJSON>(deck.slides)) {
    if (!obj(s)) continue;
    fill(s.bg);
    list<ElementJSON>(s.elements).forEach(walk);
  }
  return [...out];
}

async function fetchMedia(deck: DeckJSON, getAsset: GetAsset, warnings: Warnings): Promise<Map<AssetRef, Media>> {
  const refs = assetsOf(deck);
  const fetched = new Map<AssetRef, Uint8Array | null>();
  // The same asset is fetched once, whoever refers to it and however many times.
  const byId = new Map<string, Promise<Uint8Array | null>>();
  const fetchOne = (ref: AssetRef): Promise<Uint8Array | null> => {
    const now = async (): Promise<Uint8Array | null> => {
      try {
        return (await getAsset(ref))?.bytes ?? null;
      } catch {
        return null;
      }
    };
    if (typeof ref.id !== 'string') return now();
    let p = byId.get(ref.id);
    if (!p) byId.set(ref.id, (p = now()));
    return p;
  };
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < refs.length; i = next++) {
      const ref = refs[i]!;
      let bytes = await fetchOne(ref);
      if (!bytes && typeof ref.data === 'string') bytes = decodeBase64(ref.data);
      fetched.set(ref, bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, refs.length) }, worker));

  const byPrint = new Map<string, Media[]>();
  const out = new Map<AssetRef, Media>();
  let n = 0;
  for (const ref of refs) {
    const bytes = fetched.get(ref);
    if (!bytes || bytes.length === 0) {
      warnings.add('picture-lost', (k) => `${plural(k, 'picture')} could not be fetched and ${k === 1 ? 'was' : 'were'} left out.`);
      continue;
    }
    const mime = assetMimeOf(bytes);
    if (!mime) {
      warnings.add('picture-format', (k) => `${plural(k, 'picture')} in a format a .pptx file cannot hold ${k === 1 ? 'was' : 'were'} left out.`);
      continue;
    }
    const key = fingerprint(bytes);
    let media = byPrint.get(key)?.find((m) => sameBytes(m.bytes, bytes));
    if (!media) {
      const size = imageSize(bytes);
      media = { path: `ppt/media/image${++n}.${EXT[mime]}`, bytes, ext: EXT[mime]!, ...(size ? { width: size.width, height: size.height } : {}) };
      byPrint.set(key, [...(byPrint.get(key) ?? []), media]);
    }
    out.set(ref, media);
  }
  return out;
}

// ── the package ─────────────────────────────────────────────────────────────

const blankLayout = (): LayoutJSON => ({ id: 'blank', name: 'Blank', elements: [] });

export async function writePptxReport(deck: DeckJSON, getAsset: GetAsset, opts: PptxWriteOptions = {}): Promise<PptxWriteResult> {
  const warnings = new Warnings();
  const aspect = (['16:9', '4:3', '16:10'] as const).find((a) => a === deck.size) ?? '16:9';
  const space: Space = spaceFor(aspect);
  // A slide that is not a slide is still a slide: a blank one, so the count is the count.
  const slides: SlideJSON[] = list<SlideJSON>(deck.slides).map((s) => obj<SlideJSON>(s) ?? { layout: '', elements: [] });
  const given = list<LayoutJSON>(deck.layouts).filter((l) => obj(l) !== null);
  const layouts: LayoutJSON[] = given.length > 0 ? given : [blankLayout()];
  const master = obj<DeckJSON['master']>(deck.master) ?? { elements: [], styles: { title: {}, body: [], other: {} } };
  const theme = safeTheme(deck.theme, 'Violet');
  const when = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.UTC(2026, 0, 1);

  const media = await fetchMedia(deck, getAsset, warnings);
  const files: Zippable = {};
  const types: { part: string; type: string }[] = [];
  const put = (part: string, xml: string, type?: string): void => {
    files[part] = new TextEncoder().encode(xml);
    if (type) types.push({ part: `/${part}`, type });
  };

  let chartCount = 0;
  const useMedia = new Set<Media>();
  const make = (rels: Rels, extra: Partial<PartOut> & { slideNumber?: number } = {}): PartOut => {
    let id = 1;
    return {
      space,
      rels,
      theme,
      slideNumber: extra.slideNumber ?? 1,
      warnings,
      media(asset): MediaRef | null {
        const m = media.get(asset as AssetRef);
        if (!m) return null;
        useMedia.add(m);
        return { target: `../media/${m.path.slice('ppt/media/'.length)}`, ...(m.width ? { width: m.width } : {}), ...(m.height ? { height: m.height } : {}) };
      },
      chart(data: ChartData): string | null {
        const k = chartCount + 1;
        const workbook = chartWorkbook(data);
        const cRels = new Rels();
        const rId = cRels.add('package', `../embeddings/Microsoft_Excel_Sheet${k}.xlsx`);
        const xml = chartPartXml(data, rId);
        if (!xml || !workbook) {
          warnings.add('chart-empty', (n) => `${plural(n, 'chart')} with no data ${n === 1 ? 'was' : 'were'} left out.`);
          return null;
        }
        chartCount = k;
        put(`ppt/charts/chart${k}.xml`, xml, CT.chart);
        put(`ppt/charts/_rels/chart${k}.xml.rels`, cRels.toXml());
        files[`ppt/embeddings/Microsoft_Excel_Sheet${k}.xlsx`] = [workbook, { level: 0 }];
        return `../charts/chart${k}.xml`;
      },
      nextId: () => ++id,
      ...extra
    };
  };

  // ── theme, layouts ───────────────────────────────────────────────────────
  const themeText = themeXml(theme, 'Violet');
  put('ppt/theme/theme1.xml', themeText, CT.theme);
  const plans = new Map<string, PhPlan[]>();
  const layoutRels: Rels[] = [];
  layouts.forEach((layout, i) => {
    const rels = new Rels();
    rels.add('slideMaster', '../slideMasters/slideMaster1.xml');
    const plan: PhPlan[] = [];
    const out = make(rels, { plan, ...(layout.styles ? { phStyles: layout.styles } : {}) });
    put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(layout, out), CT.layout);
    plans.set(layout.id, plan);
    layoutRels.push(rels);
  });
  layouts.forEach((_, i) => put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, layoutRels[i]!.toXml()));

  // ── master ───────────────────────────────────────────────────────────────
  const mRels = new Rels();
  const layoutRIds = layouts.map((_, i) => mRels.add('slideLayout', `../slideLayouts/slideLayout${i + 1}.xml`));
  mRels.add('theme', '../theme/theme1.xml');
  put('ppt/slideMasters/slideMaster1.xml', masterXml(master, layouts, layoutRIds, make(mRels)), CT.master);
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', mRels.toXml());

  // ── slides and notes ─────────────────────────────────────────────────────
  const byId = new Map(layouts.map((l, i) => [l.id, i] as const));
  const fallbackIndex = Math.max(0, layouts.findIndex((l) => l.id === 'blank' || /^blank$/i.test(l.name)));
  const pRels = new Rels();
  const masterRId = pRels.add('slideMaster', 'slideMasters/slideMaster1.xml');
  const slideRIds: string[] = [];
  let anyNotes = false;
  slides.forEach((slide, i) => {
    const k = i + 1;
    const li = byId.get(slide.layout) ?? fallbackIndex;
    const rels = new Rels();
    rels.add('slideLayout', `../slideLayouts/slideLayout${li + 1}.xml`);
    const layoutPhs = plans.get(layouts[li]!.id) ?? [];
    const out = make(rels, { slideNumber: k, layoutPhs, taken: new Set<number>() });
    put(`ppt/slides/slide${k}.xml`, slideXml(slide, out), CT.slide);
    if (slide.notes && hasText(slide.notes)) {
      anyNotes = true;
      rels.add('notesSlide', `../notesSlides/notesSlide${k}.xml`);
      const nRels = new Rels();
      nRels.add('notesMaster', '../notesMasters/notesMaster1.xml');
      nRels.add('slide', `../slides/slide${k}.xml`);
      put(`ppt/notesSlides/notesSlide${k}.xml`, notesSlideXml(slide.notes, make(nRels, { slideNumber: k })), CT.notes);
      put(`ppt/notesSlides/_rels/notesSlide${k}.xml.rels`, nRels.toXml());
    }
    put(`ppt/slides/_rels/slide${k}.xml.rels`, rels.toXml());
    slideRIds.push(pRels.add('slide', `slides/slide${k}.xml`));
  });

  // ── the notes master, when there are notes ───────────────────────────────
  let notesMasterRId: string | undefined;
  if (anyNotes) {
    notesMasterRId = pRels.add('notesMaster', 'notesMasters/notesMaster1.xml');
    put('ppt/notesMasters/notesMaster1.xml', notesMasterXml(), CT.notesMaster);
    const nm = new Rels();
    nm.add('theme', '../theme/theme2.xml');
    put('ppt/notesMasters/_rels/notesMaster1.xml.rels', nm.toXml());
    put('ppt/theme/theme2.xml', themeText, CT.theme);
  }

  // ── the presentation ─────────────────────────────────────────────────────
  pRels.add('presProps', 'presProps.xml');
  pRels.add('viewProps', 'viewProps.xml');
  pRels.add('theme', 'theme/theme1.xml');
  pRels.add('tableStyles', 'tableStyles.xml');
  put('ppt/presentation.xml', presentationXml({ space, slideRIds, masterRId, other: master.styles?.other, out: make(new Rels()), ...(notesMasterRId ? { notesMasterRId } : {}) }), CT.presentation);
  put('ppt/_rels/presentation.xml.rels', pRels.toXml());
  put('ppt/presProps.xml', PRES_PROPS, CT.presProps);
  put('ppt/viewProps.xml', VIEW_PROPS, CT.viewProps);
  put('ppt/tableStyles.xml', TABLE_STYLES, CT.tableStyles);
  put('docProps/core.xml', coreXml(opts.title, when), CT.core);
  put('docProps/app.xml', appXml(slides.length, space.aspect), CT.app);

  const root = new Rels();
  root.add('officeDocument', 'ppt/presentation.xml');
  root.add('http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml');
  root.add('extended-properties', 'docProps/app.xml');
  put('_rels/.rels', root.toXml());

  for (const m of useMedia) files[m.path] = [m.bytes, { level: 0 }];

  const ordered = [...types].sort((a, b) => a.part.localeCompare(b.part));
  const ct =
    XML_DECL +
    el(
      'Types',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' },
      el('Default', { Extension: 'rels', ContentType: 'application/vnd.openxmlformats-package.relationships+xml' }) +
        el('Default', { Extension: 'xml', ContentType: 'application/xml' }) +
        el('Default', { Extension: 'png', ContentType: 'image/png' }) +
        el('Default', { Extension: 'jpeg', ContentType: 'image/jpeg' }) +
        el('Default', { Extension: 'gif', ContentType: 'image/gif' }) +
        el('Default', { Extension: 'webp', ContentType: 'image/webp' }) +
        el('Default', { Extension: 'xlsx', ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) +
        ordered.map((t) => el('Override', { PartName: t.part, ContentType: t.type })).join('')
    );
  const all: Zippable = { '[Content_Types].xml': new TextEncoder().encode(ct) };
  for (const key of Object.keys(files).sort()) all[key] = files[key]!;
  const bytes = zipSync(all, { level: 6, mtime: new Date(when) });
  return { bytes, warnings: warnings.list() };
}

export async function writePptx(deck: DeckJSON, getAsset: GetAsset, opts: PptxWriteOptions = {}): Promise<Uint8Array> {
  return (await writePptxReport(deck, getAsset, opts)).bytes;
}
