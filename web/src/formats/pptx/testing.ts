/**
 * Building small pptx files for tests: a master, a layout and slides from a few strings.
 * Imported by tests only.
 */

import { strToU8, zipSync } from 'fflate';

export const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export interface Fixture {
  /** Slide size in EMU. */
  size?: { cx: number; cy: number };
  /** The inside of each slide's `p:spTree` (after the group properties, which are added). */
  slides: string[];
  /** Attributes on `p:sld`, per slide: `{ show: '0' }`. */
  slideAttrs?: Record<number, string>;
  /** Anything between `p:cSld` and the end of the slide (a transition, a clrMapOvr). */
  slideAfter?: Record<number, string>;
  /** A `p:bg` for the slide. */
  slideBg?: Record<number, string>;
  /** Extra relationships of each slide (1-based slide number). */
  slideRels?: Record<number, Rel[]>;
  layoutTree?: string;
  layoutAttrs?: string;
  layoutName?: string;
  masterTree?: string;
  masterBg?: string;
  /** Replaces `p:txStyles`. */
  txStyles?: string;
  clrMap?: string;
  theme?: string;
  /** Extra parts by path. */
  files?: Record<string, Uint8Array | string>;
}

export const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

export const GROUP_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const TX_STYLES = `<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750" algn="l"><a:buChar char="&#8211;"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>`;

/** A title placeholder at 838200,365125 and a body one, as PowerPoint's master has. */
export const MASTER_TREE =
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>';

/** A layout with the title and a body placeholder that state no place of their own. */
export const LAYOUT_TREE =
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>';

const rels = (list: Rel[]): string =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : REL + r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

export function makePptx(f: Fixture): Uint8Array {
  const size = f.size ?? { cx: 12192000, cy: 6858000 };
  const n = f.slides.length;
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, text: string | Uint8Array): void => {
    files[path] = typeof text === 'string' ? strToU8(text) : text;
  };
  put('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
  put('_rels/.rels', rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]));
  put(
    'ppt/presentation.xml',
    `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${f.slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
      .join('')}</p:sldIdLst><p:sldSz cx="${size.cx}" cy="${size.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  );
  put(
    'ppt/_rels/presentation.xml.rels',
    rels([{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }, ...f.slides.map((_, i) => ({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` }))])
  );
  put('ppt/theme/theme1.xml', f.theme ?? THEME);
  put(
    'ppt/slideMasters/slideMaster1.xml',
    `${XML}<p:sldMaster ${NS}><p:cSld>${f.masterBg ?? ''}<p:spTree>${GROUP_HEAD}${f.masterTree ?? MASTER_TREE}</p:spTree></p:cSld>${f.clrMap ?? '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>${f.txStyles ?? TX_STYLES}</p:sldMaster>`
  );
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]));
  put(
    'ppt/slideLayouts/slideLayout1.xml',
    `${XML}<p:sldLayout ${NS} ${f.layoutAttrs ?? 'type="obj"'}><p:cSld name="${f.layoutName ?? 'Title and Content'}"><p:spTree>${GROUP_HEAD}${f.layoutTree ?? LAYOUT_TREE}</p:spTree></p:cSld></p:sldLayout>`
  );
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
  f.slides.forEach((tree, i) => {
    const k = i + 1;
    put(
      `ppt/slides/slide${k}.xml`,
      `${XML}<p:sld ${NS} ${f.slideAttrs?.[k] ?? ''}><p:cSld>${f.slideBg?.[k] ?? ''}<p:spTree>${GROUP_HEAD}${tree}</p:spTree></p:cSld>${f.slideAfter?.[k] ?? ''}</p:sld>`
    );
    put(`ppt/slides/_rels/slide${k}.xml.rels`, rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, ...(f.slideRels?.[k] ?? [])]));
  });
  for (const [path, data] of Object.entries(f.files ?? {})) put(path, data);
  void n;
  return zipSync(files);
}

/** A `p:sp` with a place, a geometry and a body of paragraphs (`<a:p>…</a:p>`). */
export function sp(opts: { id?: number; name?: string; x?: number; y?: number; cx?: number; cy?: number; prst?: string; fill?: string; ln?: string; body?: string; ph?: string; txBox?: boolean; extra?: string }): string {
  const { id = 10, name = `Shape ${id}`, x = 0, y = 0, cx = 1270000, cy = 635000, prst = 'rect' } = opts;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${opts.txBox ? ' txBox="1"' : ''}/><p:nvPr>${opts.ph ?? ''}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${opts.fill ?? ''}${opts.ln ?? ''}${opts.extra ?? ''}</p:spPr>` +
    (opts.body !== undefined ? `<p:txBody><a:bodyPr/><a:lstStyle/>${opts.body}</p:txBody>` : '') +
    '</p:sp>'
  );
}

/** One paragraph of plain runs. */
export const para = (text: string, rPr = '', pPr = ''): string => `<a:p>${pPr ? `<a:pPr ${pPr}/>` : ''}<a:r><a:rPr lang="en-US"${rPr ? ` ${rPr}` : ''}/><a:t>${text}</a:t></a:r></a:p>`;

export const solid = (hex: string): string => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
