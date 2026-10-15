/**
 * A hand-written pptx writer for the corpus: three dialects (what PowerPoint, Google Slides and
 * LibreOffice write, from memory of their files), each a minimal OOXML package.
 *
 * This is not the writer under test and shares no code with it. It writes the XML a deck's author
 * would, records what it wrote (the text, the kind and the box of each element), and that record is
 * the corpus's `<name>.expect.json`: what must be true of the file independently of the reader.
 */

import { strToU8, zipSync } from 'fflate';

export const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
export const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
const REL = (t) => `${R}/${t}`;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = (s) => esc(s).replace(/"/g, '&quot;');

/** `<tag a="1">inner</tag>`; attributes that are undefined or false are left out. */
export function t(tag, attrs = {}, inner = '') {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false && v !== null)
    .map(([k, v]) => ` ${k}="${v === true ? '1' : q(v)}"`)
    .join('');
  return inner === '' ? `<${tag}${a}/>` : `<${tag}${a}>${inner}</${tag}>`;
}

// ── colour ──────────────────────────────────────────────────────────────────

/** 'FF0000', or { scheme: 'accent1', lumMod, lumOff, alpha, tint, shade }, or { rgb, alpha, lumMod }. */
export function clr(c) {
  if (typeof c === 'string') return t('a:srgbClr', { val: c });
  const kids = ['lumMod', 'lumOff', 'alpha', 'tint', 'shade', 'satMod'].filter((k) => c[k] !== undefined).map((k) => t(`a:${k}`, { val: c[k] })).join('');
  if (c.rgb) return t('a:srgbClr', { val: c.rgb }, kids);
  if (c.sys) return t('a:sysClr', { val: c.sys, lastClr: c.last }, kids);
  if (c.prst) return t('a:prstClr', { val: c.prst }, kids);
  return t('a:schemeClr', { val: c.scheme }, kids);
}
export const solid = (c) => t('a:solidFill', {}, clr(c));
export const ln = (w, c, extra = '', attrs = {}) => t('a:ln', { w, ...attrs }, (c ? solid(c) : '<a:noFill/>') + extra);

// ── pictures ────────────────────────────────────────────────────────────────

const MEDIA_EXT = { png: 'png', jpeg: 'jpeg', gif: 'gif', webp: 'webp', emf: 'emf', svg: 'svg', bin: 'bin' };

// ── units ───────────────────────────────────────────────────────────────────

export const EMU = 12700; // per point
export const INCH = 914400;
/** Deck px of an EMU extent on a slide `cx` wide. */
export const px = (cx, emu) => Math.round(((emu * 1920) / cx) * 100) / 100;

// ── dialects ────────────────────────────────────────────────────────────────

const OFFICE_FMT = `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>`;

function themeXml({ name, colors, major, minor }) {
  const slot = (n) => {
    const c = colors[n];
    return t(`a:${n}`, {}, c.sys ? t('a:sysClr', { val: c.sys, lastClr: c.last }) : t('a:srgbClr', { val: c }));
  };
  return (
    XML +
    t(
      'a:theme',
      { 'xmlns:a': A, name },
      t(
        'a:themeElements',
        {},
        t('a:clrScheme', { name }, ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(slot).join('')) +
          t('a:fontScheme', { name }, t('a:majorFont', {}, t('a:latin', { typeface: major }) + '<a:ea typeface=""/><a:cs typeface=""/>') + t('a:minorFont', {}, t('a:latin', { typeface: minor }) + '<a:ea typeface=""/><a:cs typeface=""/>')) +
          OFFICE_FMT
      ) +
        '<a:objectDefaults/><a:extraClrSchemeLst/>'
    )
  );
}

export const OFFICE_COLORS = {
  dk1: { sys: 'windowText', last: '000000' },
  lt1: { sys: 'window', last: 'FFFFFF' },
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72'
};

const CLR_MAP_LIGHT = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

/** The nine levels of a style, from a list of [marL, indent, sz, bullet]. */
function lvls(tag, specs, defaults = {}) {
  return specs
    .map(([marL, indent, sz, bu], i) =>
      t(
        `a:lvl${i + 1}pPr`,
        { marL, indent, algn: 'l', defTabSz: 914400, rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1', ...defaults.p },
        (defaults.pChildren ?? '') +
          (bu ?? '') +
          t('a:defRPr', { sz, kern: 1200 }, solid({ scheme: 'tx1' }) + `<a:latin typeface="${defaults.font ?? '+mn-lt'}"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>`)
      )
    )
    .join('');
}

const BU = (ch, font = 'Arial') => `<a:buFont typeface="${font}" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="${ch}"/>`;

/** PowerPoint's own txStyles. */
function officeTxStyles() {
  const spc = '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef>';
  return t(
    'p:txStyles',
    {},
    t('p:titleStyle', {}, t('a:lvl1pPr', { algn: 'l', defTabSz: 914400, rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1' }, '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>' + t('a:defRPr', { sz: 4400, kern: 1200 }, solid({ scheme: 'tx1' }) + '<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/>'))) +
      t(
        'p:bodyStyle',
        {},
        lvls('body', [
          [228600, -228600, 2800, BU('•')],
          [685800, -228600, 2400, BU('•')],
          [1143000, -228600, 2000, BU('•')],
          [1600200, -228600, 1800, BU('•')],
          [2057400, -228600, 1800, BU('•')],
          [2514600, -228600, 1800, BU('•')],
          [2971800, -228600, 1800, BU('•')],
          [3429000, -228600, 1800, BU('•')],
          [3886200, -228600, 1800, BU('•')]
        ], { pChildren: spc })
      ) +
      t('p:otherStyle', {}, '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' + lvls('other', [[0, undefined, 1800], [457200, undefined, 1800], [914400, undefined, 1800], [1371600, undefined, 1800], [1828800, undefined, 1800], [2286000, undefined, 1800], [2743200, undefined, 1800], [3200400, undefined, 1800], [3657600, undefined, 1800]]))
  );
}

// ── the deck ────────────────────────────────────────────────────────────────

const PRES_CT = 'application/vnd.openxmlformats-officedocument.presentationml';

/** Geometry on a 12192000 x 6858000 slide; scaled to the deck's size by `Deck.fit`. */
const POWERPOINT = {
  name: 'powerpoint',
  size: [12192000, 6858000],
  theme: { name: 'Office Theme', colors: OFFICE_COLORS, major: 'Calibri Light', minor: 'Calibri' },
  clrMap: CLR_MAP_LIGHT,
  txStyles: officeTxStyles,
  places: {
    title: [838200, 365125, 10515600, 1325563],
    body: [838200, 1825625, 10515600, 4351338],
    dt: [838200, 6356350, 2743200, 365125],
    ftr: [4038600, 6356350, 4114800, 365125],
    sldNum: [8610600, 6356350, 2743200, 365125],
    ctrTitle: [1524000, 1122363, 9144000, 2387600],
    subTitle: [1524000, 3602038, 9144000, 1655762],
    half1: [838200, 1825625, 5181600, 4351338],
    half2: [6172200, 1825625, 5181600, 4351338]
  },
  layouts: [
    { name: 'Title Slide', type: 'title', ph: ['ctrTitle', 'subTitle:1', 'dt:10', 'ftr:11', 'sldNum:12'] },
    { name: 'Title and Content', type: 'obj', ph: ['title', 'body:1', 'dt:10', 'ftr:11', 'sldNum:12'] },
    { name: 'Section Header', type: 'secHead', ph: ['title', 'body:1', 'dt:10', 'ftr:11', 'sldNum:12'] },
    { name: 'Two Content', type: 'twoObj', ph: ['title', 'half1:1', 'half2:2', 'dt:10', 'ftr:11', 'sldNum:12'] },
    { name: 'Title Only', type: 'titleOnly', ph: ['title', 'dt:10', 'ftr:11', 'sldNum:12'] },
    { name: 'Blank', type: 'blank', ph: ['dt:10', 'ftr:11', 'sldNum:12'] }
  ]
};

const GOOGLE = {
  name: 'google',
  size: [9144000, 5143500],
  theme: {
    name: 'Simple Light',
    colors: { dk1: '000000', lt1: 'FFFFFF', dk2: '595959', lt2: 'EEEEEE', accent1: 'FFAB40', accent2: '212121', accent3: '757575', accent4: 'BDBDBD', accent5: 'F5F5F5', accent6: 'FFFFFF', hlink: '0000FF', folHlink: '800080' },
    major: 'Arial',
    minor: 'Arial'
  },
  // Google maps bg2 to dk2 and tx2 to lt2.
  clrMap: '<p:clrMap bg1="lt1" tx1="dk1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
  txStyles() {
    const lv = (i, marL, sz, ch) =>
      t(`a:lvl${i}pPr`, { marL, lvl: i - 1, indent: -342900, algn: 'l', rtl: '0' }, '<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>' + `<a:buSzPts val="${sz}"/><a:buChar char="${ch}"/>` + t('a:defRPr', { sz }, solid({ scheme: 'dk1' }) + '<a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/><a:sym typeface="Arial"/>'));
    return t(
      'p:txStyles',
      {},
      t('p:titleStyle', {}, t('a:lvl1pPr', { lvl: '0', algn: 'l', rtl: '0' }, '<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/>' + t('a:defRPr', { sz: 2800 }, solid({ scheme: 'dk1' }) + '<a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/><a:sym typeface="Arial"/>'))) +
        t('p:bodyStyle', {}, [lv(1, 457200, 1800, '●'), lv(2, 914400, 1800, '○'), lv(3, 1371600, 1800, '■'), lv(4, 1828800, 1800, '●'), lv(5, 2286000, 1800, '○')].join('')) +
        t('p:otherStyle', {}, t('a:defPPr', {}, '<a:defRPr lang="en-US"/>'))
    );
  },
  places: {
    title: [311700, 744575, 8520600, 572700],
    body: [311700, 1567500, 8520600, 3000300],
    dt: [0, 0, 0, 0],
    ftr: [0, 0, 0, 0],
    sldNum: [8472458, 4663217, 548700, 393600],
    ctrTitle: [311700, 744575, 5000000, 2052600],
    subTitle: [311700, 2834125, 5000000, 792600],
    half1: [311700, 1567500, 4152900, 3000300],
    half2: [4679400, 1567500, 4152900, 3000300]
  },
  layouts: [
    { name: 'Title slide', type: 'title', ph: ['ctrTitle', 'subTitle:1', 'sldNum:12'] },
    { name: 'Section header', type: 'secHead', ph: ['title', 'sldNum:12'] },
    { name: 'Title and body', type: 'tx', ph: ['title', 'body:1', 'sldNum:12'] },
    { name: 'Title and two columns', type: 'twoColTx', ph: ['title', 'half1:1', 'half2:2', 'sldNum:12'] },
    { name: 'Title only', type: 'titleOnly', ph: ['title', 'sldNum:12'] },
    { name: 'Blank', type: 'blank', ph: ['sldNum:12'] }
  ]
};

const LIBREOFFICE = {
  name: 'libreoffice',
  size: [12192000, 6858000],
  theme: {
    name: 'Office Theme',
    colors: { dk1: '000000', lt1: 'FFFFFF', dk2: '1F497D', lt2: 'EEECE1', accent1: '4F81BD', accent2: 'C0504D', accent3: '9BBB59', accent4: '8064A2', accent5: '4BACC6', accent6: 'F79646', hlink: '0000FF', folHlink: '800080' },
    major: 'Calibri',
    minor: 'Calibri'
  },
  clrMap: CLR_MAP_LIGHT,
  txStyles() {
    const lv = (i, marL, sz) => t(`a:lvl${i}pPr`, { marL, indent: -285750, algn: 'l' }, '<a:buSzPct val="100000"/><a:buFont typeface="Arial"/><a:buChar char="•"/>' + t('a:defRPr', { sz }, solid('000000') + '<a:latin typeface="Liberation Sans"/>'));
    return t(
      'p:txStyles',
      {},
      t('p:titleStyle', {}, t('a:lvl1pPr', { algn: 'ctr' }, '<a:buNone/>' + t('a:defRPr', { sz: 4400 }, solid('000000') + '<a:latin typeface="Liberation Sans"/>'))) +
        t('p:bodyStyle', {}, [lv(1, 457200, 3200), lv(2, 914400, 2800), lv(3, 1371600, 2400), lv(4, 1828800, 2000), lv(5, 2286000, 2000)].join('')) +
        t('p:otherStyle', {}, t('a:lvl1pPr', {}, t('a:defRPr', { sz: 1800 }, solid('000000') + '<a:latin typeface="Liberation Sans"/>')))
    );
  },
  places: {
    title: [609600, 274638, 10972800, 1143000],
    body: [609600, 1600200, 10972800, 4525963],
    dt: [609600, 6356350, 2844800, 365125],
    ftr: [4165600, 6356350, 3860800, 365125],
    sldNum: [8737600, 6356350, 2844800, 365125],
    ctrTitle: [609600, 274638, 10972800, 1143000],
    subTitle: [609600, 1600200, 10972800, 4525963],
    half1: [609600, 1600200, 5386388, 4525963],
    half2: [6196013, 1600200, 5386388, 4525963]
  },
  layouts: [
    { name: 'Title Slide', type: 'title', ph: ['ctrTitle', 'subTitle:1'] },
    { name: 'Title, Content', type: 'obj', ph: ['title', 'body:1'] },
    { name: 'Title and 2 Content', type: 'twoObj', ph: ['title', 'half1:1', 'half2:2'] },
    { name: 'Title Only', type: 'titleOnly', ph: ['title'] },
    { name: 'Blank Slide', type: 'blank', ph: [] }
  ]
};

export const DIALECTS = { powerpoint: POWERPOINT, google: GOOGLE, libreoffice: LIBREOFFICE };

const PH_TYPE = { ctrTitle: 'ctrTitle', subTitle: 'subTitle', title: 'title', body: undefined, half1: undefined, half2: undefined, dt: 'dt', ftr: 'ftr', sldNum: 'sldNum' };
const PH_NAME = { ctrTitle: 'Title', subTitle: 'Subtitle', title: 'Title', body: 'Content Placeholder', half1: 'Content Placeholder', half2: 'Content Placeholder', dt: 'Date Placeholder', ftr: 'Footer Placeholder', sldNum: 'Slide Number Placeholder' };
const PROMPT = {
  ctrTitle: 'Click to edit Master title style',
  title: 'Click to edit Master title style',
  subTitle: 'Click to edit Master subtitle style',
  body: 'Click to edit Master text styles',
  half1: 'Click to edit Master text styles',
  half2: 'Click to edit Master text styles',
  dt: '1/1/2026',
  ftr: 'Footer',
  sldNum: '‹#›'
};
const KIND_OF = { ctrTitle: 'title', title: 'title', subTitle: 'body', body: 'body', half1: 'body', half2: 'body', dt: 'dt', ftr: 'ftr', sldNum: 'sldNum' };

// ── paragraphs ──────────────────────────────────────────────────────────────

function runProps(o, d, slide) {
  const kids =
    (o.color ? solid(o.color) : '') +
    (o.hl ? t('a:highlight', {}, clr(o.hl)) : '') +
    (o.font ? t('a:latin', { typeface: o.font }) + (d.name === 'google' ? `<a:ea typeface="${o.font}"/><a:cs typeface="${o.font}"/><a:sym typeface="${o.font}"/>` : '') : '') +
    (o.href !== undefined ? t('a:hlinkClick', { 'r:id': slide.rel('hyperlink', o.href, true) }) : '') +
    (o.jump ? t('a:hlinkClick', { 'r:id': slide.rel('slide', o.jump), action: 'ppaction://hlinksldjump' }) : '');
  return {
    attrs: {
      lang: d.name === 'google' ? 'en' : 'en-US',
      sz: o.sz !== undefined ? Math.round(o.sz * 100) : undefined,
      b: o.b === undefined ? (d.name === 'libreoffice' ? '0' : undefined) : o.b ? '1' : '0',
      i: o.i ? '1' : undefined,
      u: o.u ? (o.u === true ? 'sng' : o.u) : undefined,
      strike: o.strike ? 'sngStrike' : d.name === 'libreoffice' ? 'noStrike' : undefined,
      baseline: o.sup ? 30000 : o.sub ? -25000 : undefined,
      spc: d.name === 'libreoffice' ? '-1' : undefined,
      dirty: d.name === 'powerpoint' ? '0' : undefined
    },
    kids
  };
}

const BULLET_FONT = { Wingdings: 'Wingdings' };

function paraProps(p, d) {
  const bu =
    p.bullet === 'none'
      ? '<a:buNone/>'
      : p.bullet && p.bullet.num
        ? t('a:buAutoNum', { type: p.bullet.num, startAt: p.bullet.start })
        : p.bullet && p.bullet.char
          ? (p.bullet.color ? t('a:buClr', {}, clr(p.bullet.color)) : '') + (p.bullet.font ? `<a:buFont typeface="${p.bullet.font}"/>` : '') + t('a:buChar', { char: p.bullet.char })
          : '';
  const kids =
    (p.lnSpc ? t('a:lnSpc', {}, t('a:spcPct', { val: p.lnSpc })) : '') +
    (p.spcBef !== undefined ? t('a:spcBef', {}, p.spcBefPct ? t('a:spcPct', { val: p.spcBef }) : t('a:spcPts', { val: p.spcBef })) : '') +
    (p.spcAft !== undefined ? t('a:spcAft', {}, t('a:spcPts', { val: p.spcAft })) : '') +
    bu;
  const attrs = { marL: p.marL, lvl: p.lvl ? p.lvl : d.name === 'google' ? 0 : undefined, indent: p.indent, algn: p.algn, rtl: d.name === 'google' ? '0' : undefined };
  return Object.values(attrs).some((v) => v !== undefined) || kids ? t('a:pPr', attrs, kids) : '';
}

/** One paragraph spec as `a:p`, and the text it shows. */
export function paragraph(spec, d, slide) {
  const p = typeof spec === 'string' ? { t: spec } : spec;
  const runs = p.runs ?? [p];
  let text = '';
  let xml = '';
  for (const r of runs) {
    if (r.br) {
      xml += t('a:br', {}, t('a:rPr', { lang: 'en-US' }));
      text += '\n';
      continue;
    }
    if (r.fld) {
      const rp = runProps(r, d, slide);
      xml += t('a:fld', { id: '{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}', type: r.fld }, t('a:rPr', rp.attrs, rp.kids) + t('a:t', {}, esc(r.t ?? '1')));
      text += r.fld === 'slidenum' ? '‹#›' : (r.t ?? '');
      continue;
    }
    if (r.t === undefined) continue;
    const rp = runProps(r, d, slide);
    xml += t('a:r', {}, t('a:rPr', rp.attrs, rp.kids) + t('a:t', {}, esc(r.t)));
    text += r.t;
  }
  const end = d.name === 'google' ? '' : t('a:endParaRPr', { lang: 'en-US', dirty: d.name === 'powerpoint' ? '0' : undefined });
  return { xml: t('a:p', {}, paraProps(p, d) + xml + end), text };
}

export function paragraphs(list, d, slide) {
  const out = (Array.isArray(list) ? list : [list]).map((s) => paragraph(s, d, slide));
  return { xml: out.map((o) => o.xml).join(''), text: out.map((o) => o.text).join('\n') };
}

// ── a deck ──────────────────────────────────────────────────────────────────

export class Deck {
  constructor(dialect, opts = {}) {
    this.d = DIALECTS[dialect];
    this.dialect = dialect;
    this.size = opts.size ?? this.d.size;
    this.title = opts.title ?? 'Corpus deck';
    this.slides = [];
    this.media = [];
    this.charts = [];
    this.parts = {};
    this.masterBg = opts.masterBg ?? '';
    this.masterTree = opts.masterTree ?? '';
    this.layoutExtra = opts.layoutExtra ?? {};
    this.theme = opts.theme ?? this.d.theme;
    this.clrMap = opts.clrMap ?? this.d.clrMap;
    this.txStyles = opts.txStyles ?? this.d.txStyles;
    this.layouts = opts.layouts ?? this.d.layouts;
    this.strict = opts.strict ?? false;
    this.extraMasters = opts.extraMasters ?? [];
    this.defaultTextSz = opts.defaultTextSz ?? 1800;
  }

  get cx() {
    return this.size[0];
  }
  get cy() {
    return this.size[1];
  }

  /** The dialect's place for a placeholder key, scaled to this deck's size. */
  place(key) {
    const [x, y, w, h] = this.d.places[key];
    const sx = this.cx / this.d.size[0];
    const sy = this.cy / this.d.size[1];
    return [Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)];
  }

  layoutIndex(name) {
    const i = this.layouts.findIndex((l) => l.name === name);
    if (i < 0) throw new Error(`no layout ${name}`);
    return i;
  }

  /** Adds a picture to the package and returns its part name. */
  addMedia(bytes, ext = 'png') {
    const existing = this.media.find((m) => m.bytes === bytes && m.ext === ext);
    if (existing) return existing.path;
    const path = `ppt/media/image${this.media.length + 1}.${MEDIA_EXT[ext] ?? ext}`;
    this.media.push({ path, bytes, ext });
    return path;
  }

  slide(layoutName, build) {
    const s = new Slide(this, this.layoutIndex(layoutName));
    this.slides.push(s);
    build?.(s);
    return s;
  }

  /** What must be true of the file: independent of any reader. */
  expectation() {
    return {
      dialect: this.dialect,
      size: this.cx / this.cy > 1.7 ? '16:9' : this.cx / this.cy > 1.5 ? '16:10' : '4:3',
      slides: this.slides.length,
      layouts: this.layouts.map((l) => l.name),
      slideLayouts: this.slides.map((s) => this.layouts[s.layout].name),
      hidden: this.slides.map((s) => !!s.isHidden),
      notes: this.slides.map((s) => s.notesText ?? null),
      transitions: this.slides.map((s) => s.transitionKind ?? null),
      elements: this.slides.map((s) => s.expected),
      charts: this.slides.flatMap((s) => s.expectedCharts),
      warnings: this.expectedWarnings ?? []
    };
  }

  build() {
    const files = {};
    const types = [];
    const put = (path, xml, ct) => {
      files[path] = typeof xml === 'string' ? strToU8(xml) : xml;
      if (ct) types.push([`/${path}`, ct]);
    };
    const d = this.d;
    const NSx = this.strict ? strictNs : NS;
    const hasNotes = this.slides.some((s) => s.notes);

    // ── theme, master, layouts ────────────────────────────────────────────
    put('ppt/theme/theme1.xml', themeXml({ ...this.theme }), `application/vnd.openxmlformats-officedocument.theme+xml`);
    const masters = [{ index: 1, theme: 1, layouts: this.layouts, bg: this.masterBg, tree: this.masterTree, clrMap: this.clrMap, txStyles: this.txStyles, first: 0 }];
    let layoutCount = this.layouts.length;
    for (const [k, m] of this.extraMasters.entries()) {
      const themeNo = k + 2 + (hasNotes ? 1 : 0);
      put(`ppt/theme/theme${themeNo}.xml`, themeXml(m.theme), `application/vnd.openxmlformats-officedocument.theme+xml`);
      masters.push({ index: k + 2, theme: themeNo, layouts: m.layouts, bg: m.bg ?? '', tree: m.tree ?? '', clrMap: m.clrMap ?? this.clrMap, txStyles: m.txStyles ?? this.txStyles, first: layoutCount });
      layoutCount += m.layouts.length;
    }
    const masterXmls = [];
    for (const m of masters) {
      const layoutRels = [];
      m.layouts.forEach((l, i) => {
        const n = m.first + i + 1;
        put(`ppt/slideLayouts/slideLayout${n}.xml`, this.layoutXml(l, m, NSx), `${PRES_CT}.slideLayout+xml`);
        put(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, relsXml([{ id: 'rId1', type: 'slideMaster', target: `../slideMasters/slideMaster${m.index}.xml` }, ...(l.rels ?? [])]), undefined);
        layoutRels.push({ id: `rId${i + 1}`, type: 'slideLayout', target: `../slideLayouts/slideLayout${n}.xml` });
      });
      put(`ppt/slideMasters/slideMaster${m.index}.xml`, this.masterXml(m, NSx), `${PRES_CT}.slideMaster+xml`);
      put(`ppt/slideMasters/_rels/slideMaster${m.index}.xml.rels`, relsXml([...layoutRels, { id: `rId${m.layouts.length + 1}`, type: 'theme', target: `../theme/theme${m.theme}.xml` }, ...(m.rels ?? [])]), undefined);
      masterXmls.push(m);
    }

    // ── slides, notes ─────────────────────────────────────────────────────
    this.slides.forEach((s, i) => {
      const n = i + 1;
      put(`ppt/slides/slide${n}.xml`, s.xml(NSx), `${PRES_CT}.slide+xml`);
      const rels = [{ id: 'rId1', type: 'slideLayout', target: `../slideLayouts/slideLayout${this.globalLayout(s.layout, s.masterIndex)}.xml` }, ...s.rels];
      if (s.notes) {
        rels.push({ id: `rId${rels.length + 1}`, type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` });
        put(`ppt/notesSlides/notesSlide${n}.xml`, this.notesXml(s, NSx), `${PRES_CT}.notesSlide+xml`);
        put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relsXml([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` }]), undefined);
      }
      put(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(rels), undefined);
    });
    if (hasNotes) {
      put('ppt/notesMasters/notesMaster1.xml', this.notesMasterXml(NSx), `${PRES_CT}.notesMaster+xml`);
      put('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]), undefined);
      put('ppt/theme/theme2.xml', themeXml({ ...this.theme }), `application/vnd.openxmlformats-officedocument.theme+xml`);
    }
    this.charts.forEach((c, i) => {
      put(`ppt/charts/chart${i + 1}.xml`, c.xml, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
    });
    for (const [path, v] of Object.entries(this.parts)) put(path, v.data, v.type);
    for (const m of this.media) files[m.path] = m.bytes;

    // ── the presentation ──────────────────────────────────────────────────
    const prels = [];
    masterXmls.forEach((m, i) => prels.push({ id: `rId${i + 1}`, type: 'slideMaster', target: `slideMasters/slideMaster${m.index}.xml` }));
    this.slides.forEach((_, i) => prels.push({ id: `rId${masters.length + i + 1}`, type: 'slide', target: `slides/slide${i + 1}.xml` }));
    let next = masters.length + this.slides.length + 1;
    const notesRid = hasNotes ? `rId${next++}` : null;
    if (hasNotes) prels.push({ id: notesRid, type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
    for (const [type, target] of [['presProps', 'presProps.xml'], ['viewProps', 'viewProps.xml'], ['theme', 'theme/theme1.xml'], ['tableStyles', 'tableStyles.xml']]) prels.push({ id: `rId${next++}`, type, target });
    put('ppt/_rels/presentation.xml.rels', relsXml(prels), undefined);
    const sldIds = this.slides.map((_, i) => t('p:sldId', { id: 256 + i, 'r:id': `rId${masters.length + i + 1}` })).join('');
    put(
      'ppt/presentation.xml',
      XML +
        t(
          'p:presentation',
          { ...NSattrs(NSx), saveSubsetFonts: '1' },
          t('p:sldMasterIdLst', {}, masterXmls.map((m, i) => t('p:sldMasterId', { id: 2147483648 + i * 100, 'r:id': `rId${i + 1}` })).join('')) +
            (hasNotes ? t('p:notesMasterIdLst', {}, t('p:notesMasterId', { 'r:id': notesRid })) : '') +
            t('p:sldIdLst', {}, sldIds) +
            t('p:sldSz', { cx: this.cx, cy: this.cy, type: this.dialect === 'powerpoint' && this.cx === 9144000 && this.cy === 6858000 ? undefined : undefined }) +
            t('p:notesSz', { cx: 6858000, cy: 9144000 }) +
            this.defaultTextStyle(NSx)
        ),
      `${PRES_CT}.presentation.main+xml`
    );
    put('ppt/presProps.xml', XML + t('p:presentationPr', NSattrs(NSx)), `${PRES_CT}.presProps+xml`);
    put('ppt/viewProps.xml', XML + t('p:viewPr', NSattrs(NSx), '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>'), `${PRES_CT}.viewProps+xml`);
    put('ppt/tableStyles.xml', XML + t('a:tblStyleLst', { 'xmlns:a': A, def: '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}' }), `${PRES_CT}.tableStyles+xml`);
    put('docProps/core.xml', XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(this.title)}</dc:title><dc:creator>Corpus</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`, 'application/vnd.openxmlformats-package.core-properties+xml');
    put('docProps/app.xml', XML + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${this.dialect === 'powerpoint' ? 'Microsoft Office PowerPoint' : this.dialect === 'google' ? 'Google Slides' : 'LibreOffice/7.6.4.1$Linux_X86_64'}</Application><Slides>${this.slides.length}</Slides></Properties>`, 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
    put('_rels/.rels', relsXml([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }, { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' }, { id: 'rId3', type: 'extended-properties', target: 'docProps/app.xml' }]), undefined);

    const defaults = [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml'], ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['emf', 'image/x-emf'], ['svg', 'image/svg+xml'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']];
    const ct = XML + t('Types', { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' }, defaults.map(([e, c]) => t('Default', { Extension: e, ContentType: c })).join('') + types.map(([p, c]) => t('Override', { PartName: p, ContentType: c })).join(''));
    const all = { '[Content_Types].xml': strToU8(ct) };
    for (const k of Object.keys(files).sort()) all[k] = files[k];
    return zipSync(all, { level: 6, mtime: new Date(Date.UTC(2026, 0, 1)) });
  }

  globalLayout(layout, masterIndex = 1) {
    const m = masterIndex - 1;
    let first = 0;
    if (m > 0) first = this.layouts.length + this.extraMasters.slice(0, m - 1).reduce((a, x) => a + x.layouts.length, 0);
    return first + layout + 1;
  }

  defaultTextStyle() {
    if (this.dialect === 'google') return '';
    const lv = [];
    for (let i = 1; i <= 9; i++)
      lv.push(t(`a:lvl${i}pPr`, { marL: 457200 * (i - 1), algn: 'l', defTabSz: 914400, rtl: '0', eaLnBrk: '1', latinLnBrk: '0', hangingPunct: '1' }, t('a:defRPr', { sz: this.defaultTextSz, kern: 1200 }, solid({ scheme: 'tx1' }) + '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>')));
    return t('p:defaultTextStyle', {}, '<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' + lv.join(''));
  }

  phXml(key, idx, ctx) {
    // ctx: 'master' | 'layout'; the shape of a placeholder in a master or a layout.
    const d = this.d;
    const [x, y, w, h] = this.place(key);
    const type = PH_TYPE[key];
    const explicit = ctx === 'master' || d.name !== 'powerpoint' || ['ctrTitle', 'subTitle', 'half1', 'half2'].includes(key);
    const sz = key === 'dt' ? 'half' : key === 'ftr' || key === 'sldNum' ? 'quarter' : undefined;
    const phAttrs = { type, sz, idx: ctx === 'master' ? { title: undefined, body: 1, dt: 2, ftr: 3, sldNum: 4 }[key] : idx };
    const id = this.nextShapeId?.() ?? 2;
    const anchor = key === 'title' && ctx === 'master' ? 'ctr' : key === 'ctrTitle' ? 'b' : key === 'dt' || key === 'ftr' || key === 'sldNum' ? 'ctr' : undefined;
    const bodyPr = t('a:bodyPr', d.name === 'google' ? { spcFirstLastPara: '1', wrap: 'square', lIns: 91425, tIns: 91425, rIns: 91425, bIns: 91425, anchor: key === 'title' ? 'b' : 't', anchorCtr: '0' } : { vert: ctx === 'master' ? 'horz' : undefined, lIns: ctx === 'master' ? 91440 : undefined, tIns: ctx === 'master' ? 45720 : undefined, rIns: ctx === 'master' ? 91440 : undefined, bIns: ctx === 'master' ? 45720 : undefined, anchor, rtlCol: ctx === 'master' ? '0' : undefined }, key === 'dt' || key === 'ftr' || key === 'sldNum' ? '' : d.name === 'libreoffice' ? '<a:noAutofit/>' : '<a:normAutofit/>');
    let lst = '';
    if (ctx === 'layout' && d.name === 'powerpoint') {
      if (key === 'ctrTitle') lst = t('a:lstStyle', {}, t('a:lvl1pPr', { algn: 'ctr' }, t('a:defRPr', { sz: 6000 })));
      if (key === 'subTitle') lst = t('a:lstStyle', {}, t('a:lvl1pPr', { marL: 0, indent: 0, algn: 'ctr' }, '<a:buNone/>' + t('a:defRPr', { sz: 2400 })));
    }
    const prompt = PROMPT[key];
    const body =
      key === 'sldNum'
        ? `<a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>`
        : `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(prompt)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`;
    return t(
      'p:sp',
      {},
      t('p:nvSpPr', {}, t('p:cNvPr', { id, name: `${PH_NAME[key]} ${id - 1}` }) + t('p:cNvSpPr', {}, '<a:spLocks noGrp="1"/>') + t('p:nvPr', {}, t('p:ph', phAttrs))) +
        t('p:spPr', {}, explicit ? t('a:xfrm', {}, t('a:off', { x, y }) + t('a:ext', { cx: w, cy: h })) + (ctx === 'master' || d.name !== 'powerpoint' ? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : '') : '') +
        t('p:txBody', {}, bodyPr + (lst || '<a:lstStyle/>') + body)
    );
  }

  masterXml(m, NSx) {
    let n = 1;
    this.nextShapeId = () => ++n;
    const keys = ['title', 'body', 'dt', 'ftr', 'sldNum'].filter((k) => this.d.name !== 'google' || !['dt', 'ftr'].includes(k));
    const tree = m.tree + keys.map((k) => this.phXml(k, undefined, 'master')).join('');
    this.nextShapeId = undefined;
    return (
      XML +
      t(
        'p:sldMaster',
        NSattrs(NSx),
        t('p:cSld', {}, (m.bg || t('p:bg', {}, t('p:bgRef', { idx: 1001 }, t('a:schemeClr', { val: 'bg1' })))) + t('p:spTree', {}, groupHead + tree)) +
          m.clrMap +
          t('p:sldLayoutIdLst', {}, m.layouts.map((_, i) => t('p:sldLayoutId', { id: 2147483649 + m.index * 1000 + i, 'r:id': `rId${i + 1}` })).join('')) +
          m.txStyles()
      )
    );
  }

  layoutXml(l, m, NSx) {
    let n = 1;
    this.nextShapeId = () => ++n;
    const tree = (l.tree ?? '') + l.ph.map((spec) => {
      const [key, idx] = spec.split(':');
      return this.phXml(key, idx === undefined ? undefined : Number(idx), 'layout');
    }).join('') + (l.treeAfter ?? '');
    this.nextShapeId = undefined;
    return (
      XML +
      t(
        'p:sldLayout',
        { ...NSattrs(NSx), type: l.type, preserve: '1', showMasterSp: l.showMasterSp === false ? '0' : undefined },
        t('p:cSld', { name: l.name }, (l.bg ?? '') + t('p:spTree', {}, groupHead + tree)) + t('p:clrMapOvr', {}, l.clrMapOvr ?? '<a:masterClrMapping/>')
      )
    );
  }

  notesMasterXml(NSx) {
    return (
      XML +
      t(
        'p:notesMaster',
        NSattrs(NSx),
        t('p:cSld', {}, t('p:bg', {}, t('p:bgRef', { idx: 1001 }, t('a:schemeClr', { val: 'bg1' }))) + t('p:spTree', {}, groupHead + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>`)) +
          CLR_MAP_LIGHT +
          '<p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle>'
      )
    );
  }

  notesXml(s, NSx) {
    const { xml } = paragraphs(s.notes, this.d, s);
    return (
      XML +
      t(
        'p:notes',
        NSattrs(NSx),
        t('p:cSld', {}, t('p:spTree', {}, groupHead + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${xml}</p:txBody></p:sp>`)) + t('p:clrMapOvr', {}, '<a:masterClrMapping/>')
      )
    );
  }
}

const strictNs = { a: 'http://purl.oclc.org/ooxml/drawingml/main', r: 'http://purl.oclc.org/ooxml/officeDocument/relationships', p: 'http://purl.oclc.org/ooxml/presentationml/main' };
const NSattrs = (ns) => (ns === NS ? { 'xmlns:a': A, 'xmlns:r': R, 'xmlns:p': P } : { 'xmlns:a': ns.a, 'xmlns:r': ns.r, 'xmlns:p': ns.p });

const groupHead = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

export function relsXml(list) {
  return (
    XML +
    t(
      'Relationships',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' },
      list.map((r) => t('Relationship', { Id: r.id, Type: r.type.startsWith('http') ? r.type : REL(r.type), Target: r.target, TargetMode: r.external ? 'External' : undefined })).join('')
    )
  );
}

// ── a slide ─────────────────────────────────────────────────────────────────

const GOOGLE_BODY = (lvl) => ({ marL: 457200 * ((lvl ?? 0) + 1), indent: -342900, bullet: { char: ['●', '○', '■'][(lvl ?? 0) % 3] }, spcBef: (lvl ?? 0) === 0 ? 0 : 0, spcAft: 0, algn: 'l' });

export class Slide {
  constructor(deck, layout) {
    this.deck = deck;
    this.layout = layout;
    this.masterIndex = 1;
    this.tree = '';
    this.rels = [];
    this.expected = [];
    this.expectedCharts = [];
    this.nid = 1;
    this.bgXml = '';
    this.after = '';
    this.attrs = {};
    this.notes = null;
    this.notesText = null;
  }

  id() {
    return ++this.nid;
  }

  rel(type, target, external = false) {
    const hit = this.rels.find((r) => r.type === type && r.target === target && !!r.external === external);
    if (hit) return hit.id;
    const id = `rId${this.rels.length + 2}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  get cx() {
    return this.deck.cx;
  }

  box(x, y, w, h) {
    return [px(this.cx, x), px(this.cx, y), px(this.cx, w), px(this.cx, h)];
  }

  add(part) {
    this.tree += part.xml;
    this.expected.push(part.exp);
    return this;
  }

  /** A paragraph list as XML and text, with Google's explicit paragraph properties where the dialect writes them. */
  paras(list, opts = {}) {
    const d = this.deck.d;
    const items = (Array.isArray(list) ? list : [list]).map((p) => {
      const o = typeof p === 'string' ? { t: p } : { ...p };
      if (opts.google && d.name === 'google') {
        const g = GOOGLE_BODY(o.lvl);
        for (const [k, v] of Object.entries(g)) if (o[k] === undefined) o[k] = v;
      }
      if (d.name === 'google' && o.sz === undefined && !o.runs && opts.sz) o.sz = opts.sz;
      return o;
    });
    return paragraphs(items, d, this);
  }

  bodyPr(o = {}) {
    const d = this.deck.d;
    const fit = o.fit === 'shrink' ? '<a:normAutofit/>' : o.fit === 'grow' ? '<a:spAutoFit/>' : o.fit === 'none' ? '<a:noAutofit/>' : '';
    const base = d.name === 'google' ? { spcFirstLastPara: '1', wrap: o.wrap === false ? 'none' : 'square', lIns: 91425, tIns: 91425, rIns: 91425, bIns: 91425, anchor: o.anchor ?? 't', anchorCtr: '0' } : { wrap: o.wrap === false ? 'none' : o.wrap === true ? 'square' : undefined, lIns: o.insets?.[0], tIns: o.insets?.[1], rIns: o.insets?.[2], bIns: o.insets?.[3], anchor: o.anchor, vert: o.vert, rtlCol: '0' };
    if (d.name === 'google' && o.insets) [base.lIns, base.tIns, base.rIns, base.bIns] = o.insets;
    if (o.vert) base.vert = o.vert;
    return t('a:bodyPr', base, fit);
  }

  // ── placeholders ──────────────────────────────────────────────────────────

  mkPh(key, paras, o = {}) {
    const deck = this.deck;
    const d = deck.d;
    const spec = deck.layouts[this.layout].ph.find((x) => x.split(':')[0] === key);
    if (!spec) throw new Error(`layout ${deck.layouts[this.layout].name} has no ${key}`);
    const idx = spec.includes(':') ? Number(spec.split(':')[1]) : undefined;
    const id = this.id();
    const place = o.box ?? deck.place(key);
    const explicit = o.box !== undefined || d.name !== 'powerpoint';
    const { xml: pxml, text } = this.paras(paras ?? [], { google: key === 'body' || key === 'half1' || key === 'half2' || key === 'subTitle' });
    const type = PH_TYPE[key];
    const xml = t(
      'p:sp',
      {},
      t('p:nvSpPr', {}, t('p:cNvPr', { id, name: o.name ?? (d.name === 'google' ? `Google Shape;${id};p1` : `${PH_NAME[key]} ${id - 1}`) }) + t('p:cNvSpPr', {}, '<a:spLocks noGrp="1"/>') + t('p:nvPr', {}, t('p:ph', { type, idx, sz: key === 'dt' ? 'half' : key === 'ftr' || key === 'sldNum' ? 'quarter' : undefined }))) +
        t('p:spPr', {}, explicit ? t('a:xfrm', {}, t('a:off', { x: place[0], y: place[1] }) + t('a:ext', { cx: place[2], cy: place[3] })) + (d.name === 'powerpoint' ? '' : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>') + (d.name === 'libreoffice' ? '<a:ln><a:noFill/></a:ln>' : '') : '') +
        t('p:txBody', {}, this.bodyPr(o.body ?? {}) + '<a:lstStyle/>' + (pxml || '<a:p><a:endParaRPr lang="en-US"/></a:p>'))
    );
    return { xml, exp: { kind: 'shape', ph: PH_TYPE[key] ?? (key.startsWith('half') ? 'body' : 'body'), box: this.box(...place), text: text || null } };
  }

  ph(key, paras, o) {
    return this.add(this.mkPh(key, paras, o));
  }
  title(text, o) {
    return this.ph(this.deck.layouts[this.layout].ph.some((p) => p.startsWith('ctrTitle')) ? 'ctrTitle' : 'title', text, o);
  }
  subtitle(paras, o) {
    return this.ph('subTitle', paras, o);
  }
  body(paras, o) {
    return this.ph('body', paras, o);
  }

  // ── shapes ────────────────────────────────────────────────────────────────

  mkShape(prst, x, y, w, h, o = {}) {
    const d = this.deck.d;
    const id = this.id();
    const { xml: pxml, text } = o.paras !== undefined ? this.paras(o.paras) : { xml: '', text: '' };
    const style = o.style
      ? t('p:style', {}, t('a:lnRef', { idx: 2 }, clr({ scheme: 'accent1', shade: 50000 })) + t('a:fillRef', { idx: 1 }, clr({ scheme: 'accent1' })) + t('a:effectRef', { idx: 0 }, clr({ scheme: 'accent1' })) + t('a:fontRef', { idx: 'minor' }, clr({ scheme: 'lt1' })))
      : '';
    const fill = o.fill === null ? '<a:noFill/>' : o.fill ? (typeof o.fill === 'string' && o.fill.startsWith('<') ? o.fill : solid(o.fill)) : o.style ? '' : o.txBox ? '<a:noFill/>' : '';
    const line = o.ln === null ? '<a:ln><a:noFill/></a:ln>' : o.ln ? o.ln : '';
    const geom = prst === 'cust' ? '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>' : t('a:prstGeom', { prst }, t('a:avLst', {}, o.adj !== undefined ? t('a:gd', { name: 'adj', fmla: `val ${o.adj}` }) : ''));
    const xml = t(
      'p:sp',
      {},
      t('p:nvSpPr', {}, t('p:cNvPr', { id, name: o.name ?? (d.name === 'google' ? `Google Shape;${id};p1` : `${o.txBox ? 'TextBox' : 'Shape'} ${id - 1}`), descr: o.alt, hidden: o.hidden ? '1' : undefined }) + t('p:cNvSpPr', { txBox: o.txBox ? '1' : undefined }) + '<p:nvPr/>') +
        t('p:spPr', {}, t('a:xfrm', { rot: o.rot !== undefined ? Math.round(o.rot * 60000) : undefined, flipH: o.flipH ? '1' : undefined, flipV: o.flipV ? '1' : undefined }, t('a:off', { x, y }) + t('a:ext', { cx: w, cy: h })) + geom + fill + line + (o.shadow ? '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>' : '')) +
        style +
        (o.paras !== undefined ? t('p:txBody', {}, this.bodyPr({ fit: o.fit, wrap: o.wrap, ...(o.body ?? {}) }) + (o.lst ? t('a:lstStyle', {}, o.lst) : '<a:lstStyle/>') + pxml) : '')
    );
    const exp = { kind: 'shape', box: this.box(x, y, w, h), text: text || null, ...(o.expect ?? {}) };
    return { xml, exp: o.hidden ? null : exp };
  }

  shape(prst, x, y, w, h, o) {
    const p = this.mkShape(prst, x, y, w, h, o);
    if (!p.exp) {
      this.tree += p.xml;
      return this;
    }
    return this.add(p);
  }

  textBox(x, y, w, h, paras, o = {}) {
    return this.add(this.mkShape('rect', x, y, w, h, { ...o, txBox: true, paras }));
  }

  mkLine(x1, y1, x2, y2, o = {}) {
    const id = this.id();
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    const xml = t(
      'p:cxnSp',
      {},
      t('p:nvCxnSpPr', {}, t('p:cNvPr', { id, name: o.name ?? `Straight Connector ${id - 1}` }) + '<p:cNvCxnSpPr/><p:nvPr/>') +
        t('p:spPr', {}, t('a:xfrm', { flipH: x2 < x1 ? '1' : undefined, flipV: y2 < y1 ? '1' : undefined }, t('a:off', { x, y }) + t('a:ext', { cx: w, cy: h })) + t('a:prstGeom', { prst: o.prst ?? 'line' }, '<a:avLst/>') + t('a:ln', { w: o.w ?? 19050 }, solid(o.color ?? '000000') + (o.dash ? t('a:prstDash', { val: o.dash }) : '') + (o.head ? t('a:headEnd', { type: o.head }) : '') + (o.tail ? t('a:tailEnd', { type: o.tail }) : '')))
    );
    return { xml, exp: { kind: 'line', box: this.box(x, y, w, h), text: null } };
  }

  line(x1, y1, x2, y2, o) {
    return this.add(this.mkLine(x1, y1, x2, y2, o));
  }

  mkPic(path, x, y, w, h, o = {}) {
    const id = this.id();
    const d = this.deck.d;
    const target = `../media/${path.slice('ppt/media/'.length)}`;
    const rid = o.link ? this.rel('image', o.link, true) : this.rel('image', target);
    const svg = o.svg ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${this.rel('image', `../media/${o.svg.slice('ppt/media/'.length)}`)}"/></a:ext></a:extLst>` : '';
    const crop = o.crop ? t('a:srcRect', o.crop) : d.name === 'powerpoint' ? '' : '';
    const xml = t(
      'p:pic',
      {},
      t('p:nvPicPr', {}, t('p:cNvPr', { id, name: o.name ?? `Picture ${id - 1}`, descr: o.alt }) + t('p:cNvPicPr', {}, '<a:picLocks noChangeAspect="1"/>') + t('p:nvPr', {}, o.nvExtra ?? '')) +
        t('p:blipFill', {}, t('a:blip', { [o.link ? 'r:link' : 'r:embed']: rid }, svg) + crop + '<a:stretch><a:fillRect/></a:stretch>') +
        t('p:spPr', {}, t('a:xfrm', { rot: o.rot !== undefined ? Math.round(o.rot * 60000) : undefined }, t('a:off', { x, y }) + t('a:ext', { cx: w, cy: h })) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' + (o.ln ?? ''))
    );
    return { xml, exp: o.dropped ? null : { kind: 'image', box: this.box(x, y, w, h), text: null, crop: o.crop ? Object.fromEntries(Object.entries(o.crop).map(([k, v]) => [k, v / 100000])) : undefined, alt: o.alt } };
  }

  pic(path, x, y, w, h, o) {
    const p = this.mkPic(path, x, y, w, h, o);
    if (!p.exp) {
      this.tree += p.xml;
      return this;
    }
    return this.add(p);
  }

  // ── groups ────────────────────────────────────────────────────────────────

  mkGroup(g, parts, o = {}) {
    const id = this.id();
    const xml = t(
      'p:grpSp',
      {},
      t('p:nvGrpSpPr', {}, t('p:cNvPr', { id, name: o.name ?? `Group ${id - 1}` }) + '<p:cNvGrpSpPr/><p:nvPr/>') +
        t('p:grpSpPr', {}, t('a:xfrm', { rot: g.rot !== undefined ? Math.round(g.rot * 60000) : undefined, flipH: g.flipH ? '1' : undefined, flipV: g.flipV ? '1' : undefined }, t('a:off', { x: g.x, y: g.y }) + t('a:ext', { cx: g.w, cy: g.h }) + t('a:chOff', { x: g.chX ?? g.x, y: g.chY ?? g.y }) + t('a:chExt', { cx: g.chW ?? g.w, cy: g.chH ?? g.h }))) +
        parts.map((p) => p.xml).join('')
    );
    return { xml, exp: { kind: 'group', box: o.box ?? this.box(g.x, g.y, g.w, g.h), text: parts.map((p) => p.exp?.text).filter(Boolean).join('\n') || null, children: parts.map((p) => p.exp).filter(Boolean) } };
  }

  group(g, parts, o) {
    return this.add(this.mkGroup(g, parts, o));
  }

  // ── tables ────────────────────────────────────────────────────────────────

  table(x, y, cols, rows, o = {}) {
    const id = this.id();
    const d = this.deck.d;
    const texts = [];
    const trs = rows
      .map((row) => {
        const cells = Array.isArray(row) ? row : row.cells;
        const h = Array.isArray(row) ? (o.rowH ?? 370840) : row.h;
        return t(
          'a:tr',
          { h },
          cells
            .map((c) => {
              const cell = typeof c === 'string' ? { t: c } : c;
              const hasText = cell.t !== undefined || cell.paras !== undefined;
              const { xml, text } = hasText ? this.paras(cell.paras ?? { t: cell.t, b: cell.b, sz: cell.sz, color: cell.color }) : { xml: '<a:p><a:endParaRPr lang="en-US"/></a:p>', text: '' };
              if (text && !cell.hMerge && !cell.vMerge) texts.push(text);
              return t(
                'a:tc',
                { gridSpan: cell.gridSpan, rowSpan: cell.rowSpan, hMerge: cell.hMerge ? '1' : undefined, vMerge: cell.vMerge ? '1' : undefined },
                t('a:txBody', {}, '<a:bodyPr/><a:lstStyle/>' + xml) + t('a:tcPr', { anchor: cell.anchor }, (cell.border ? ['lnL', 'lnR', 'lnT', 'lnB'].map((s) => t(`a:${s}`, { w: 12700 }, solid(cell.border))).join('') : '') + (cell.fill ? solid(cell.fill) : ''))
              );
            })
            .join('')
        );
      })
      .join('');
    const w = cols.reduce((a, b) => a + b, 0);
    const h = rows.reduce((a, r) => a + (Array.isArray(r) ? (o.rowH ?? 370840) : r.h), 0);
    const xml = t(
      'p:graphicFrame',
      {},
      t('p:nvGraphicFramePr', {}, t('p:cNvPr', { id, name: `Table ${id - 1}` }) + '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/>') +
        t('p:xfrm', {}, t('a:off', { x, y }) + t('a:ext', { cx: o.frameW ?? w, cy: o.frameH ?? h })) +
        t('a:graphic', {}, t('a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/table' }, t('a:tbl', {}, t('a:tblPr', { firstRow: o.firstRow === false ? undefined : '1', bandRow: o.bandRow === false ? undefined : '1' }, o.style === false ? '' : '<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>') + t('a:tblGrid', {}, cols.map((c) => t('a:gridCol', { w: c })).join('')) + trs)))
    );
    void d;
    return this.add({ xml, exp: { kind: 'table', box: this.box(x, y, w, h), text: texts.join('\n') || null, tableTexts: texts, rows: rows.length, cols: cols.length } });
  }

  // ── charts ────────────────────────────────────────────────────────────────

  chart(x, y, w, h, spec) {
    const id = this.id();
    const n = this.deck.charts.length + 1;
    const xml = chartXml(spec);
    this.deck.charts.push({ xml });
    const rid = this.rel('chart', `../charts/chart${n}.xml`);
    const frame = t(
      'p:graphicFrame',
      {},
      t('p:nvGraphicFramePr', {}, t('p:cNvPr', { id, name: `Chart ${id - 1}` }) + '<p:cNvGraphicFramePr/><p:nvPr/>') +
        t('p:xfrm', {}, t('a:off', { x, y }) + t('a:ext', { cx: w, cy: h })) +
        t('a:graphic', {}, t('a:graphicData', { uri: C }, t('c:chart', { 'xmlns:c': C, 'r:id': rid })))
    );
    const kind = { col: 'column', bar: 'bar', line: 'line', pie: 'pie', scatter: 'scatter', area: 'line', doughnut: 'pie' }[spec.type];
    this.expectedCharts.push({ chart: kind, categories: spec.cats.map(String), series: spec.series.map((s) => ({ name: s.name, values: s.vals })), title: spec.title ?? null });
    return this.add({ xml: frame, exp: { kind: 'chart', box: this.box(x, y, w, h), text: null } });
  }

  // ── slide-level ───────────────────────────────────────────────────────────

  background(xml) {
    this.bgXml = xml;
    return this;
  }
  setNotes(paras) {
    this.notes = paras;
    this.notesText = paragraphs(paras, this.deck.d, this).text;
    return this;
  }
  hidden() {
    this.attrs.show = '0';
    this.isHidden = true;
    return this;
  }
  transition(xml, kind) {
    this.after += xml;
    this.transitionKind = kind;
    return this;
  }

  xml(NSx) {
    return XML + t('p:sld', { ...NSattrs(NSx), ...this.attrs }, t('p:cSld', {}, this.bgXml + t('p:spTree', {}, groupHead + this.tree)) + t('p:clrMapOvr', {}, '<a:masterClrMapping/>') + this.after);
  }
}

// ── charts ──────────────────────────────────────────────────────────────────

function chartXml(spec) {
  const { type, cats, series, title } = spec;
  const n = cats.length;
  const col = (i) => String.fromCharCode(66 + i);
  const strCache = (vals) => t('c:strCache', {}, t('c:ptCount', { val: vals.length }) + vals.map((v, i) => t('c:pt', { idx: i }, t('c:v', {}, esc(v)))).join(''));
  const numCache = (vals) => t('c:numCache', {}, '<c:formatCode>General</c:formatCode>' + t('c:ptCount', { val: vals.length }) + vals.map((v, i) => t('c:pt', { idx: i }, t('c:v', {}, String(v)))).join(''));
  const ser = series
    .map((s, i) => {
      const tx = t('c:tx', {}, t('c:strRef', {}, t('c:f', {}, `Sheet1!$${col(i)}$1`) + strCache([s.name])));
      const sp = s.color ? t('c:spPr', {}, type === 'line' ? t('a:ln', { w: 28575 }, solid(s.color)) : solid(s.color)) : '';
      const cat = t('c:cat', {}, t('c:strRef', {}, t('c:f', {}, `Sheet1!$A$2:$A$${n + 1}`) + strCache(cats.map(String))));
      const val = t('c:val', {}, t('c:numRef', {}, t('c:f', {}, `Sheet1!$${col(i)}$2:$${col(i)}$${n + 1}`) + numCache(s.vals)));
      if (type === 'scatter') return t('c:ser', {}, t('c:idx', { val: i }) + t('c:order', { val: i }) + tx + sp + t('c:xVal', {}, t('c:numRef', {}, t('c:f', {}, `Sheet1!$A$2:$A$${n + 1}`) + numCache(cats))) + t('c:yVal', {}, t('c:numRef', {}, t('c:f', {}, `Sheet1!$${col(i)}$2:$${col(i)}$${n + 1}`) + numCache(s.vals))));
      return t('c:ser', {}, t('c:idx', { val: i }) + t('c:order', { val: i }) + tx + sp + cat + val);
    })
    .join('');
  const ax = t('c:axId', { val: 111 }) + t('c:axId', { val: 222 });
  const group = {
    col: () => t('c:barChart', {}, '<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + ser + ax),
    bar: () => t('c:barChart', {}, '<c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + ser + ax),
    line: () => t('c:lineChart', {}, '<c:grouping val="standard"/><c:varyColors val="0"/>' + ser + '<c:marker val="1"/>' + ax),
    area: () => t('c:areaChart', {}, '<c:grouping val="standard"/><c:varyColors val="0"/>' + ser + ax),
    pie: () => t('c:pieChart', {}, '<c:varyColors val="1"/>' + ser + '<c:firstSliceAng val="0"/>'),
    doughnut: () => t('c:doughnutChart', {}, '<c:varyColors val="1"/>' + ser + '<c:firstSliceAng val="0"/><c:holeSize val="50"/>'),
    scatter: () => t('c:scatterChart', {}, '<c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' + ser + ax)
  }[type]();
  const axes = type === 'pie' || type === 'doughnut' ? '' : type === 'scatter' ? '<c:valAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:valAx><c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111"/></c:valAx>' : '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222"/></c:catAx><c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111"/></c:valAx>';
  const titleEl = title ? t('c:title', {}, t('c:tx', {}, t('c:rich', {}, '<a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>' + esc(title) + '</a:t></a:r></a:p>')) + '<c:overlay val="0"/>') : '';
  return XML + t('c:chartSpace', { 'xmlns:c': C, 'xmlns:a': A, 'xmlns:r': R }, '<c:date1904 val="0"/>' + t('c:chart', {}, titleEl + `<c:autoTitleDeleted val="${title ? 0 : 1}"/>` + t('c:plotArea', {}, '<c:layout/>' + group + axes) + '<c:plotVisOnly val="1"/>'));
}

// ── packages without a deck: for the hostile corpus ─────────────────────────

/** A zip from a map of name to text or bytes. */
export function zip(files) {
  const out = {};
  for (const [k, v] of Object.entries(files)) out[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(out, { level: 6, mtime: new Date(Date.UTC(2026, 0, 1)) });
}
