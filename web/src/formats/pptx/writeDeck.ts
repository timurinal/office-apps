/**
 * The fixed parts of a pptx and the master, layouts and notes: the theme, the presentation, the
 * master with its placeholders and text styles, a layout, a slide, a notes slide.
 *
 * The master carries the five placeholders PowerPoint expects (title, body, date, footer and slide
 * number) at the places the layouts give them, so a layout the person edits in PowerPoint
 * inherits sensibly, and its text styles are the deck's `MasterJSON.styles`, so a re-import reads
 * the same styles back.
 */

import {
  type Aspect,
  type ElementJSON,
  type LayoutJSON,
  type TextStyle,
  type MasterJSON,
  type PlaceholderType,
  type SlideJSON,
  type TextBox,
  type ThemeJSON,
  type ThemeSlot,
  type Transition
} from '../../slides/model/deck';
import { SLIDE_NUMBER_TEXT } from './text';
import { GROUP_HEAD, imageSink, treeXml, type PartOut } from './writeShapes';
import { bodyPr, levelEl, levelsEl, paragraphs, type TextOut } from './writeText';
import { toEmu, type Space } from './units';
import { asColor, clean, el, esc, fillEl, list, obj, NS_A, NS_MC, NS_P, NS_P14, NS_R, XML_DECL, type ImageSink } from './xmlOut';
import { OFFICE_HEX } from './color';

const DOC_NS = { 'xmlns:a': NS_A, 'xmlns:r': NS_R, 'xmlns:p': NS_P };

export const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notes: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
} as const;

// ── the theme ───────────────────────────────────────────────────────────────

const SLOT_ORDER: ThemeSlot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'];

function hexOf(v: unknown, fallback: string): string {
  const c = asColor(v);
  return typeof c === 'string' ? c.slice(1).toUpperCase() : fallback.slice(1).toUpperCase();
}

const fontName = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 60) : fallback);

/** The theme as the writer reads it: every colour a colour and both fonts a name, whatever the deck holds. */
export function safeTheme(theme: unknown, name: string): ThemeJSON {
  const t = (obj<Partial<ThemeJSON>>(theme) ?? {}) as Partial<ThemeJSON>;
  const colors = (obj<Record<string, unknown>>(t.colors) ?? {}) as Record<string, unknown>;
  const fonts = obj<{ major?: unknown; minor?: unknown }>(t.fonts) ?? {};
  const out = { id: 'theme', name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : name, colors: {} as Record<string, string>, fonts: { major: fontName(fonts.major, 'Calibri Light'), minor: fontName(fonts.minor, 'Calibri') } };
  for (const slot of SLOT_ORDER) out.colors[slot] = `#${hexOf(colors[slot], OFFICE_HEX[slot])}`.toLowerCase();
  out.colors.folHlink = `#${hexOf(colors.folHlink, OFFICE_HEX.folHlink)}`.toLowerCase();
  return out as unknown as ThemeJSON;
}

/** A theme part. The format scheme is plain: solid fills and one weight per line style. */
export function themeXml(theme: ThemeJSON | undefined, name: string): string {
  const colors = (theme?.colors ?? {}) as Record<string, unknown>;
  const clr = SLOT_ORDER.map((slot) => el(`a:${slot}`, {}, el('a:srgbClr', { val: hexOf(colors[slot], OFFICE_HEX[slot]) }))).join('') +
    el('a:folHlink', {}, el('a:srgbClr', { val: hexOf(colors.folHlink, OFFICE_HEX.folHlink) }));
  const major = fontName(theme?.fonts?.major, 'Calibri Light');
  const minor = fontName(theme?.fonts?.minor, 'Calibri');
  const phSolid = el('a:solidFill', {}, el('a:schemeClr', { val: 'phClr' }));
  const ln = (w: number): string => el('a:ln', { w, cap: 'flat', cmpd: 'sng', algn: 'ctr' }, phSolid + el('a:prstDash', { val: 'solid' }) + el('a:miter', { lim: 800000 }));
  const effect = el('a:effectStyle', {}, '<a:effectLst/>');
  return (
    XML_DECL +
    el(
      'a:theme',
      { 'xmlns:a': NS_A, name: clean(theme?.name ?? name).slice(0, 80) },
      el(
        'a:themeElements',
        {},
        el('a:clrScheme', { name: clean(theme?.name ?? name).slice(0, 80) }, clr) +
          el(
            'a:fontScheme',
            { name: clean(theme?.name ?? name).slice(0, 80) },
            el('a:majorFont', {}, el('a:latin', { typeface: major }) + '<a:ea typeface=""/><a:cs typeface=""/>') + el('a:minorFont', {}, el('a:latin', { typeface: minor }) + '<a:ea typeface=""/><a:cs typeface=""/>')
          ) +
          el(
            'a:fmtScheme',
            { name: 'Office' },
            el('a:fillStyleLst', {}, phSolid + phSolid + phSolid) + el('a:lnStyleLst', {}, ln(6350) + ln(12700) + ln(19050)) + el('a:effectStyleLst', {}, effect + effect + effect) + el('a:bgFillStyleLst', {}, phSolid + phSolid + phSolid)
          )
      ) + '<a:objectDefaults/><a:extraClrSchemeLst/>'
    )
  );
}

// ── the presentation ────────────────────────────────────────────────────────

/**
 * What text in a shape that is no placeholder looks like: the master's "other" style, on every level, stepping
 * in half an inch a level as PowerPoint's own does. Stated here and in `otherStyle`, so a re-import reads it once.
 */
function defaultTextStyle(other: TextStyle | undefined, out: TextOut): string {
  const style = obj<TextStyle>(other) ?? {};
  let lv = '';
  for (let i = 1; i <= 9; i++) lv += levelEl(`a:lvl${i}pPr`, i === 1 ? style : { ...style, indent: undefined, bulletIndent: undefined }, out, { defRPr: true, ...(i > 1 ? { marL: 457200 * (i - 1) } : {}) });
  return el('p:defaultTextStyle', {}, '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' + lv);
}

export function presentationXml(opts: { space: Space; slideRIds: string[]; masterRId: string; notesMasterRId?: string; other?: TextStyle; out: TextOut }): string {
  const { space } = opts;
  return (
    XML_DECL +
    el(
      'p:presentation',
      { ...DOC_NS, saveSubsetFonts: true },
      el('p:sldMasterIdLst', {}, el('p:sldMasterId', { id: 2147483648, 'r:id': opts.masterRId })) +
        (opts.notesMasterRId ? el('p:notesMasterIdLst', {}, el('p:notesMasterId', { 'r:id': opts.notesMasterRId })) : '') +
        el('p:sldIdLst', {}, opts.slideRIds.map((id, i) => el('p:sldId', { id: 256 + i, 'r:id': id })).join('')) +
        el('p:sldSz', { cx: space.cx, cy: space.cy }) +
        el('p:notesSz', { cx: 6858000, cy: 9144000 }) +
        defaultTextStyle(opts.other, opts.out)
    )
  );
}

export const PRES_PROPS = `${XML_DECL}${el('p:presentationPr', DOC_NS)}`;
export const VIEW_PROPS = `${XML_DECL}${el('p:viewPr', DOC_NS, '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="76200" cy="76200"/>')}`;
export const TABLE_STYLES = `${XML_DECL}${el('a:tblStyleLst', { 'xmlns:a': NS_A, def: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}' })}`;

export function coreXml(title: string | undefined, whenMs: number): string {
  const iso = new Date(whenMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    XML_DECL +
    el(
      'cp:coreProperties',
      { 'xmlns:cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'xmlns:dc': 'http://purl.org/dc/elements/1.1/', 'xmlns:dcterms': 'http://purl.org/dc/terms/', 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance' },
      (title ? el('dc:title', {}, esc(title)) : '') +
        el('dc:creator', {}, 'Office') +
        el('cp:lastModifiedBy', {}, 'Office') +
        el('dcterms:created', { 'xsi:type': 'dcterms:W3CDTF' }, iso) +
        el('dcterms:modified', { 'xsi:type': 'dcterms:W3CDTF' }, iso)
    )
  );
}

export function appXml(slides: number, aspect: Aspect): string {
  const format = aspect === '16:9' ? 'Widescreen' : aspect === '4:3' ? 'On-screen Show (4:3)' : 'On-screen Show (16:10)';
  return XML_DECL + el('Properties', { xmlns: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties' }, el('Application', {}, 'Office') + el('Slides', {}, String(slides)) + el('PresentationFormat', {}, format));
}

// ── backgrounds and transitions ─────────────────────────────────────────────

export function bgEl(fill: SlideJSON['bg'] | undefined, images: ImageSink, space: Space): string {
  if (!fill) return '';
  return el('p:bg', {}, el('p:bgPr', {}, fillEl(fill, images, { w: 1920, h: space.height }) + '<a:effectLst/>'));
}

const PUSH_DIR: Record<string, string> = { right: 'l', left: 'r', bottom: 'u', top: 'd' };

export function transitionXml(t: Transition | undefined): string {
  if (!t || t.kind === 'none') return '';
  const dir = t.from && PUSH_DIR[t.from] ? PUSH_DIR[t.from] : undefined;
  let child: string;
  switch (t.kind) {
    case 'fade':
      child = '<p:fade/>';
      break;
    case 'push':
      child = el('p:push', { dir });
      break;
    case 'wipe':
      child = el('p:wipe', { dir });
      break;
    case 'zoom':
      child = el('p:zoom', { dir: 'in' });
      break;
    default:
      return '';
  }
  const dur = typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0 ? Math.min(60_000, Math.round(t.duration)) : undefined;
  if (dur === undefined) return el('p:transition', {}, child);
  const spd = dur <= 500 ? 'fast' : dur <= 750 ? 'med' : 'slow';
  return el(
    'mc:AlternateContent',
    { 'xmlns:mc': NS_MC },
    el('mc:Choice', { 'xmlns:p14': NS_P14, Requires: 'p14' }, el('p:transition', { spd, 'p14:dur': dur }, child)) + el('mc:Fallback', {}, el('p:transition', { spd }, child))
  );
}

// ── placeholders of the master ──────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** PowerPoint's own master places, in px on a 1080-high slide. */
const MASTER_DEFAULTS: Record<'title' | 'body' | 'dt' | 'ftr' | 'sldNum', Box> = {
  title: { x: 132, y: 57.5, w: 1656, h: 208.8 },
  body: { x: 132, y: 287.5, w: 1656, h: 685.2 },
  dt: { x: 132, y: 1001, w: 432, h: 57.5 },
  ftr: { x: 636, y: 1001, w: 648, h: 57.5 },
  sldNum: { x: 1356, y: 1001, w: 432, h: 57.5 }
};

const masterKind = (t: PlaceholderType): keyof typeof MASTER_DEFAULTS => (t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : 'body');

interface MasterPh {
  box: Box;
  textBox?: TextBox;
}

function masterPlaces(layouts: readonly LayoutJSON[], height: number): Record<keyof typeof MASTER_DEFAULTS, MasterPh> {
  const out = {} as Record<keyof typeof MASTER_DEFAULTS, MasterPh>;
  for (const k of Object.keys(MASTER_DEFAULTS) as (keyof typeof MASTER_DEFAULTS)[]) {
    const d = MASTER_DEFAULTS[k];
    out[k] = { box: { x: d.x, y: (d.y * height) / 1080, w: d.w, h: (d.h * height) / 1080 } };
  }
  // The layout whose placeholder is exactly the master's kind says where it goes (a title, not a centred title); else the first of its kind.
  const best = new Map<string, number>();
  for (const l of layouts) {
    for (const e of list<ElementJSON>(l?.elements)) {
      if (!e || typeof e !== 'object' || !('ph' in e) || !e.ph) continue;
      const k = masterKind(e.ph.type);
      const rank = e.ph.type === k ? 0 : 1;
      if ((best.get(k) ?? 2) <= rank) continue;
      best.set(k, rank);
      out[k] = { box: { x: e.x, y: e.y, w: e.w, h: e.h }, ...(e.type === 'shape' && e.textBox ? { textBox: e.textBox } : {}) };
    }
  }
  return out;
}

function masterPlaceholder(kind: keyof typeof MASTER_DEFAULTS, id: number, ph: MasterPh, out: PartOut): string {
  const sp = out.space;
  const attrs = {
    title: { type: 'title' },
    body: { type: 'body', idx: 1 },
    dt: { type: 'dt', sz: 'half', idx: 2 },
    ftr: { type: 'ftr', sz: 'quarter', idx: 3 },
    sldNum: { type: 'sldNum', sz: 'quarter', idx: 4 }
  }[kind];
  const names = { title: 'Title Placeholder', body: 'Text Placeholder', dt: 'Date Placeholder', ftr: 'Footer Placeholder', sldNum: 'Slide Number Placeholder' }[kind];
  const prompt =
    kind === 'title'
      ? '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>'
      : kind === 'body'
        ? ['Click to edit Master text styles', 'Second level', 'Third level', 'Fourth level', 'Fifth level'].map((t, i) => `<a:p><a:pPr lvl="${i}"/><a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p>`).join('')
        : kind === 'sldNum'
          ? `<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>${SLIDE_NUMBER_TEXT}</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>`
          : kind === 'dt'
            ? '<a:p><a:fld id="{3A0D7B53-5F0D-4C0F-9A0B-1B8E4B7A6C11}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>1/1/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>'
            : '<a:p><a:endParaRPr lang="en-US"/></a:p>';
  const box = ph.textBox ?? (kind === 'title' ? { anchor: 'middle' as const, autofit: 'shrink' as const } : kind === 'body' ? { autofit: 'shrink' as const } : { anchor: 'middle' as const });
  const bp = el('p:txBody', {}, bodyPr(box, sp) + '<a:lstStyle/>' + prompt);
  return el(
    'p:sp',
    {},
    el('p:nvSpPr', {}, el('p:cNvPr', { id, name: `${names} ${id - 1}` }) + el('p:cNvSpPr', {}, el('a:spLocks', { noGrp: true })) + el('p:nvPr', {}, el('p:ph', attrs))) +
      el('p:spPr', {}, el('a:xfrm', {}, el('a:off', { x: toEmu(sp, ph.box.x), y: toEmu(sp, ph.box.y) }) + el('a:ext', { cx: toEmu(sp, ph.box.w), cy: toEmu(sp, ph.box.h) })) + el('a:prstGeom', { prst: 'rect' }, '<a:avLst/>')) +
      bp
  );
}

// ── the master ──────────────────────────────────────────────────────────────

export const CLR_MAP = el('p:clrMap', { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink' });

export function masterXml(master: MasterJSON, layouts: readonly LayoutJSON[], layoutRIds: string[], out: PartOut): string {
  const places = masterPlaces(layouts, out.space.height);
  const decorations = treeXml(master.elements, out);
  const bg = master.bg ? bgEl(master.bg, imageSink(out), out.space) : el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' })));
  const phs = (['title', 'body', 'dt', 'ftr', 'sldNum'] as const).map((k) => masterPlaceholder(k, out.nextId(), places[k], out)).join('');
  const styles = master.styles ?? ({} as MasterJSON['styles']);
  const tx = el(
    'p:txStyles',
    {},
    el('p:titleStyle', {}, levelEl('a:lvl1pPr', styles.title ?? {}, out, { defRPr: true })) +
      el('p:bodyStyle', {}, levelsEl(styles.body, out)) +
      el('p:otherStyle', {}, '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' + levelEl('a:lvl1pPr', styles.other ?? {}, out, { defRPr: true }))
  );
  return (
    XML_DECL +
    el(
      'p:sldMaster',
      DOC_NS,
      el('p:cSld', {}, bg + el('p:spTree', {}, GROUP_HEAD + decorations + phs)) +
        CLR_MAP +
        el('p:sldLayoutIdLst', {}, layoutRIds.map((r, i) => el('p:sldLayoutId', { id: 2147483649 + i, 'r:id': r })).join('')) +
        tx
    )
  );
}

// ── a layout, a slide, notes ────────────────────────────────────────────────

export function layoutXml(layout: LayoutJSON, out: PartOut): string {
  const bg = layout.bg ? bgEl(layout.bg, imageSink(out), out.space) : '';
  return (
    XML_DECL +
    el(
      'p:sldLayout',
      { ...DOC_NS, showMasterSp: layout.showMaster === false ? '0' : undefined, preserve: true, userDrawn: true },
      el('p:cSld', { name: clean(layout.name ?? 'Layout').slice(0, 80) }, bg + el('p:spTree', {}, GROUP_HEAD + treeXml(layout.elements, out))) + el('p:clrMapOvr', {}, '<a:masterClrMapping/>')
    )
  );
}

export function slideXml(slide: SlideJSON, out: PartOut): string {
  const bg = slide.bg ? bgEl(slide.bg, imageSink(out), out.space) : '';
  const tree = treeXml(slide.elements, out);
  return (
    XML_DECL +
    el(
      'p:sld',
      { ...DOC_NS, show: slide.hidden === true ? '0' : undefined, showMasterSp: slide.showMaster === false ? '0' : undefined },
      el('p:cSld', {}, bg + el('p:spTree', {}, GROUP_HEAD + tree)) + el('p:clrMapOvr', {}, '<a:masterClrMapping/>') + transitionXml(slide.transition)
    )
  );
}

export function notesSlideXml(notes: SlideJSON['notes'], out: PartOut): string {
  const sp = (id: number, name: string, locks: string, ph: string, body: string): string =>
    el('p:sp', {}, el('p:nvSpPr', {}, el('p:cNvPr', { id, name }) + el('p:cNvSpPr', {}, locks) + el('p:nvPr', {}, ph)) + '<p:spPr/>' + body);
  return (
    XML_DECL +
    el(
      'p:notes',
      DOC_NS,
      el(
        'p:cSld',
        {},
        el(
          'p:spTree',
          {},
          GROUP_HEAD +
            sp(2, 'Slide Image Placeholder 1', '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>', '<p:ph type="sldImg"/>', '') +
            sp(3, 'Notes Placeholder 2', '<a:spLocks noGrp="1"/>', '<p:ph type="body" idx="1"/>', el('p:txBody', {}, '<a:bodyPr/><a:lstStyle/>' + paragraphs(notes, out)))
        )
      ) + el('p:clrMapOvr', {}, '<a:masterClrMapping/>')
    )
  );
}

export function notesMasterXml(): string {
  const sp = (id: number, name: string, locks: string, ph: string, geom: string, body: string): string =>
    el('p:sp', {}, el('p:nvSpPr', {}, el('p:cNvPr', { id, name }) + el('p:cNvSpPr', {}, locks) + el('p:nvPr', {}, ph)) + el('p:spPr', {}, geom) + body);
  const geom = (x: number, y: number, cx: number, cy: number, extra = ''): string => el('a:xfrm', {}, el('a:off', { x, y }) + el('a:ext', { cx, cy })) + el('a:prstGeom', { prst: 'rect' }, '<a:avLst/>') + extra;
  const lvl = (i: number): string =>
    el(`a:lvl${i}pPr`, { marL: 457200 * (i - 1), algn: 'l', defTabSz: 914400, rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1' }, el('a:defRPr', { sz: 1200, kern: 1200 }, el('a:solidFill', {}, el('a:schemeClr', { val: 'tx1' })) + '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'));
  return (
    XML_DECL +
    el(
      'p:notesMaster',
      DOC_NS,
      el(
        'p:cSld',
        {},
        el('p:bg', {}, el('p:bgRef', { idx: 1001 }, el('a:schemeClr', { val: 'bg1' }))) +
          el(
            'p:spTree',
            {},
            GROUP_HEAD +
              sp(2, 'Slide Image Placeholder 1', '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>', '<p:ph type="sldImg" idx="2"/>', geom(685800, 1143000, 5486400, 3086100, '<a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln>'), '') +
              sp(
                3,
                'Notes Placeholder 2',
                '<a:spLocks noGrp="1"/>',
                '<p:ph type="body" sz="quarter" idx="3"/>',
                geom(685800, 4400550, 5486400, 3600450),
                el('p:txBody', {}, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>')
              )
          )
      ) +
        CLR_MAP +
        el('p:notesStyle', {}, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(lvl).join(''))
    )
  );
}
