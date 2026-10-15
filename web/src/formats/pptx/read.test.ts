import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { ChartElement, DeckJSON, ElementJSON, Fill, GroupElement, ShapeElement, TableElement, TextDoc } from '../../slides/model/deck';
import { FormatError, isFormatError } from '../errors';
import { PNG_1PX } from '../testing';
import { readPptx } from './read';
import { GROUP_HEAD, LAYOUT_TREE, makePptx, MASTER_TREE, NS, para, solid, sp, type Fixture } from './testing';

function refusal(fn: () => unknown): FormatError {
  try {
    fn();
  } catch (e) {
    if (isFormatError(e)) return e;
    throw e;
  }
  throw new Error('was not refused');
}

const deckOf = (f: Fixture): DeckJSON => readPptx(makePptx(f)).deck;
const firstSlide = (tree: string, extra: Partial<Fixture> = {}): ElementJSON[] => deckOf({ slides: [tree], ...extra }).slides[0]!.elements;
const text = (doc: TextDoc | undefined): string => (doc?.content ?? []).map((p) => (p.content ?? []).map((n) => n.text ?? '\n').join('')).join('\n');

/** The fill of a shape whose fill is `colour` (the inside of an `a:solidFill`). */
function fillOf(colour: string, extra: Partial<Fixture> = {}): Fill | undefined {
  const el = firstSlide(sp({ fill: `<a:solidFill>${colour}</a:solidFill>` }), extra)[0] as ShapeElement;
  return el.fill;
}

describe('what is refused', () => {
  it('is not a presentation when it is not a zip, or has no presentation in it, or is a Word document', () => {
    expect(refusal(() => readPptx(strToU8('plain text that is longer than a zip signature needs, to pass a length test'))).code).toBe('not_pptx');
    expect(refusal(() => readPptx(zipSync({ 'hello.txt': strToU8('hi') }))).code).toBe('not_pptx');
    expect(refusal(() => readPptx(zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>') }))).code).toBe('not_pptx');
    expect(refusal(() => readPptx(new Uint8Array(0))).code).toBe('empty');
  });

  it('a binary .ppt, or a presentation with a password, is a kind of file that cannot be opened here', () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]);
    expect(refusal(() => readPptx(ole))).toMatchObject({ code: 'unsupported', message: 'That kind of file cannot be opened here.' });
  });

  it('says so in plain words', () => {
    expect(refusal(() => readPptx(strToU8('plain text that is longer than a zip signature needs, to pass a length test'))).message).toBe('That is not a presentation.');
  });

  it('is not a presentation when the main part is something else', () => {
    const bytes = makePptx({ slides: [''], files: { 'ppt/presentation.xml': '<p:other xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>' } });
    expect(refusal(() => readPptx(bytes)).code).toBe('not_pptx');
  });
});

describe('the slide size', () => {
  const at = (cx: number, cy: number, tree = sp({ x: cx, y: cy, cx: 100000, cy: 100000, body: para('t', 'sz="2000"') })): DeckJSON => deckOf({ slides: [tree], size: { cx, cy } });

  it('is 16:9 at 12192000 EMU wide, and a px is 6350 EMU', () => {
    const d = at(12192000, 6858000, sp({ x: 6350 * 100, y: 6350 * 50, cx: 6350 * 200, cy: 6350 * 80 }));
    expect(d.size).toBe('16:9');
    const e = d.slides[0]!.elements[0]!;
    expect([e.x, e.y, e.w, e.h]).toEqual([100, 50, 200, 80]);
  });

  it('scales a 4:3 deck to 1920 wide and its type with it', () => {
    const d = at(9144000, 6858000, sp({ x: 4572000, y: 3429000, cx: 914400, cy: 457200, body: para('t', 'sz="2000"') }));
    expect(d.size).toBe('4:3');
    const e = d.slides[0]!.elements[0] as ShapeElement;
    expect([e.x, e.y, e.w, e.h]).toEqual([960, 720, 192, 96]);
    // 20 pt on a 10 in slide is 26.67 on the 13.33 in one, to the half point.
    expect(e.text!.content[0]!.content![0]!.marks![0]!.attrs!.fontSize).toBe(26.5);
  });

  it('knows 16:10', () => {
    expect(at(9144000, 5715000).size).toBe('16:10');
    expect(at(12192000, 7620000).size).toBe('16:10');
  });

  it('takes the nearest aspect for a size that is none, and keeps everything inside it', () => {
    // A4 landscape is 1.414: nearer 4:3 than 16:10. The width fills 1920 and the height is shorter than 1440.
    const a4 = at(10692000, 7560000, sp({ x: 0, y: 0, cx: 10692000, cy: 7560000 }));
    expect(a4.size).toBe('4:3');
    const e = a4.slides[0]!.elements[0]!;
    expect(e.w).toBe(1920);
    expect(e.h).toBeLessThan(1440);
    // A portrait slide is taller than any aspect here: it is scaled to fit the height, so nothing is cut off.
    const portrait = at(6858000, 9144000, sp({ x: 0, y: 0, cx: 6858000, cy: 9144000 }));
    expect(portrait.size).toBe('4:3');
    const p = portrait.slides[0]!.elements[0]!;
    expect(p.h).toBeCloseTo(1440, 1);
    expect(p.w).toBeLessThan(1920);
  });

  it('is 16:9 with a warning when it is not a size at all', () => {
    for (const [cx, cy] of [[0, 0], [-5, 100], [2147483647, 2147483647], [100, 100]] as const) {
      const r = readPptx(makePptx({ slides: [sp({})], size: { cx, cy } }));
      expect(r.deck.size, `${cx}x${cy}`).toBe('16:9');
      expect(r.warnings).toContain('The slide size was not a size a slide can be, so the slide is 16:9.');
    }
  });
});

describe('colours', () => {
  it.each([
    ['accent1', '<a:lumMod val="60000"/><a:lumOff val="40000"/>', { theme: 'accent1', lum: 0.4 }],
    ['accent1', '<a:lumMod val="20000"/><a:lumOff val="80000"/>', { theme: 'accent1', lum: 0.8 }],
    ['accent2', '<a:lumMod val="75000"/>', { theme: 'accent2', lum: -0.25 }],
    ['accent2', '<a:lumMod val="50000"/>', { theme: 'accent2', lum: -0.5 }],
    ['accent3', '<a:tint val="40000"/>', { theme: 'accent3', lum: 0.6 }],
    ['accent3', '<a:shade val="50000"/>', { theme: 'accent3', lum: -0.5 }],
    ['accent4', '<a:alpha val="25000"/>', { theme: 'accent4', alpha: 0.25 }],
    ['accent5', '<a:lumMod val="75000"/><a:alpha val="50000"/>', { theme: 'accent5', lum: -0.25, alpha: 0.5 }],
    ['accent6', '', { theme: 'accent6' }],
    ['hlink', '', { theme: 'hlink' }],
    ['tx1', '', { theme: 'dk1' }],
    ['bg1', '', { theme: 'lt1' }],
    ['tx2', '', { theme: 'dk2' }],
    ['bg2', '<a:lumMod val="90000"/>', { theme: 'lt2', lum: -0.1 }],
    ['dk1', '', { theme: 'dk1' }]
  ])('a theme colour %s %s stays a theme colour', (val, kids, want) => {
    expect(fillOf(`<a:schemeClr val="${val}">${kids}</a:schemeClr>`)).toEqual({ kind: 'solid', color: want });
  });

  it('a followed hyperlink has no slot of its own, so it is its colour', () => {
    expect(fillOf('<a:schemeClr val="folHlink"/>')).toEqual({ kind: 'solid', color: '#954f72' });
  });

  it('a hex colour has its tint applied, in HSL', () => {
    expect(fillOf('<a:srgbClr val="4472C4"/>')).toEqual({ kind: 'solid', color: '#4472c4' });
    expect(fillOf('<a:srgbClr val="4472C4"><a:lumMod val="50000"/></a:srgbClr>')).toEqual({ kind: 'solid', color: '#203864' });
    expect(fillOf('<a:srgbClr val="FF0000"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:srgbClr>')).toEqual({ kind: 'solid', color: '#ff8080' });
    expect(fillOf('<a:srgbClr val="808080"><a:tint val="50000"/></a:srgbClr>')).toEqual({ kind: 'solid', color: '#c0c0c0' });
  });

  it('alpha on a hex colour is the fill\'s, and a theme colour keeps its own', () => {
    expect(fillOf('<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr>')).toEqual({ kind: 'solid', color: '#000000', alpha: 0.4 });
    expect(fillOf('<a:schemeClr val="accent1"><a:alpha val="40000"/></a:schemeClr>')).toEqual({ kind: 'solid', color: { theme: 'accent1', alpha: 0.4 } });
  });

  it('system, preset, HSL and scRGB colours are hex', () => {
    expect(fillOf('<a:sysClr val="windowText" lastClr="111111"/>')).toEqual({ kind: 'solid', color: '#111111' });
    expect(fillOf('<a:prstClr val="red"/>')).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(fillOf('<a:hslClr hue="0" sat="100000" lum="50000"/>')).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(fillOf('<a:scrgbClr r="100000" g="0" b="0"/>')).toEqual({ kind: 'solid', color: '#ff0000' });
  });

  it('a colour the file gets wrong is no fill at all, not a guess', () => {
    expect(fillOf('<a:srgbClr val="not a colour"/>')).toEqual({ kind: 'none' });
    expect(fillOf('<a:schemeClr val="mystery"/>')).toEqual({ kind: 'none' });
    expect(fillOf('<a:prstClr val="chartreuse-ish"/>')).toEqual({ kind: 'none' });
  });

  it('bg1 and tx1 follow the master\'s map, and its override on a slide', () => {
    const dark = '<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
    expect(fillOf('<a:schemeClr val="bg1"/>', { clrMap: dark })).toEqual({ kind: 'solid', color: { theme: 'dk1' } });
    expect(fillOf('<a:schemeClr val="tx1"/>', { clrMap: dark })).toEqual({ kind: 'solid', color: { theme: 'lt1' } });
    const over = deckOf({ slides: [sp({ fill: '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>' })], slideAfter: { 1: '<p:clrMapOvr><a:overrideClrMapping bg1="dk2" tx1="lt2" bg2="lt1" tx2="dk1" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>' } });
    expect((over.slides[0]!.elements[0] as ShapeElement).fill).toEqual({ kind: 'solid', color: { theme: 'dk2' } });
  });

  it('a gradient keeps its stops and its angle; a picture fill needs its picture', () => {
    const g = fillOf('<a:schemeClr val="accent1"/>');
    expect(g?.kind).toBe('solid');
    const grad = (firstSlide(sp({ fill: '<a:gradFill><a:gsLst><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:lin ang="2700000"/></a:gradFill>' }))[0] as ShapeElement).fill;
    expect(grad).toEqual({ kind: 'gradient', angle: 45, stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }] });
    const one = (firstSlide(sp({ fill: '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst></a:gradFill>' }))[0] as ShapeElement).fill;
    expect(one).toEqual({ kind: 'solid', color: '#ff0000' });
    const missing = (firstSlide(sp({ fill: '<a:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>' }))[0] as ShapeElement).fill;
    expect(missing).toEqual({ kind: 'none' });
  });
});

describe('a file\'s words are never keys of ours', () => {
  // `NEAREST['constructor']` is a function, `KINDS['__proto__']` is an object: a table looked up with a
  // file's own word must find only what the table holds.
  it('a preset geometry, alignment, anchor, dash, line end, bullet, transition and placeholder named for Object', () => {
    const words = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
    for (const w of words) {
      const tree =
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${w}"/><p:cNvSpPr/><p:nvPr><p:ph type="${w}" idx="${w === 'constructor' ? 1 : 7}"/></p:nvPr></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm><a:prstGeom prst="${w}"><a:avLst/></a:prstGeom><a:ln><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="${w}"/><a:headEnd type="${w}"/><a:tailEnd type="${w}"/></a:ln></p:spPr>` +
        `<p:txBody><a:bodyPr anchor="${w}"/><a:lstStyle/><a:p><a:pPr algn="${w}"><a:buAutoNum type="${w}"/></a:pPr><a:r><a:rPr><a:solidFill><a:prstClr val="${w}"/></a:solidFill></a:rPr><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`;
      const deck = deckOf({ slides: [tree], slideAfter: { 1: `<p:transition spd="${w}"><${w}/></p:transition>` } });
      const e = deck.slides[0]!.elements[0] as ShapeElement;
      expect(typeof e.shape, w).toBe('string');
      expect(e.shape, w).toBe('rect');
      expect(e.ph?.type, w).toBe('body');
      expect(e.text!.content[0]!.attrs?.align, w).toBeUndefined();
      expect(e.text!.content[0]!.attrs?.bullet, w).toMatchObject({ kind: 'number', style: 'arabicPeriod' });
      expect(e.textBox?.anchor, w).toBeUndefined();
      expect(e.line?.dash, w).toBeUndefined();
      expect(e.line?.head, w).toBeUndefined();
      const t = deck.slides[0]!.transition;
      expect(t === undefined || t.kind === 'none', w).toBe(true);
      expect(JSON.stringify(deck), w).not.toMatch(/native code|\[object/);
    }
  });
});

describe('placeholders', () => {
  const place = (x: number, y: number, cx: number, cy: number): string => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
  const ph = (id: number, ph: string, spPr: string, body = '<a:bodyPr/>'): string =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="P${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr><p:txBody>${body}<a:lstStyle/><a:p><a:r><a:t>t${id}</a:t></a:r></a:p></p:txBody></p:sp>`;

  it('take their place from the layout, and the layout\'s from the master', () => {
    const els = firstSlide(ph(2, '<p:ph type="title"/>', '') + ph(3, '<p:ph idx="1"/>', ''));
    expect([els[0]!.x, els[0]!.y, els[0]!.w, els[0]!.h]).toEqual([132, 57.5, 1656, 208.75]);
    expect([els[1]!.x, els[1]!.y, els[1]!.w, els[1]!.h]).toEqual([132, 287.5, 1656, 685.25]);
    const layout = deckOf({ slides: [''] }).layouts[0]!;
    expect(layout.elements.map((e) => [e.x, e.y])).toEqual([[132, 57.5], [132, 287.5]]);
  });

  it('match by idx before they match by type', () => {
    const layoutTree =
      ph(2, '<p:ph type="title"/>', place(0, 0, 6350 * 400, 6350 * 100)) +
      ph(3, '<p:ph idx="1"/>', place(0, 6350 * 200, 6350 * 400, 6350 * 100)) +
      ph(4, '<p:ph idx="2"/>', place(6350 * 500, 6350 * 200, 6350 * 400, 6350 * 100));
    const els = firstSlide(ph(2, '<p:ph idx="2"/>', '') + ph(3, '<p:ph idx="1"/>', ''), { layoutTree });
    expect(els.map((e) => e.x)).toEqual([500, 0]);
    expect(els.map((e) => (e as ShapeElement).ph)).toEqual([{ type: 'body', idx: 2 }, { type: 'body', idx: 1 }]);
  });

  it('a subtitle takes the body\'s place when the layout has none of its own', () => {
    const els = firstSlide(ph(2, '<p:ph type="subTitle" idx="1"/>', ''));
    expect(els[0]!.y).toBe(287.5);
    expect((els[0] as ShapeElement).ph).toEqual({ type: 'subTitle', idx: 1 });
  });

  it('merge their text box edge by edge: master, then layout, then slide', () => {
    const layoutTree = ph(2, '<p:ph type="title"/>', '', '<a:bodyPr lIns="0" anchor="b"/>');
    const els = firstSlide(ph(2, '<p:ph type="title"/>', '', '<a:bodyPr tIns="12700"/>'), { layoutTree });
    expect((els[0] as ShapeElement).textBox).toEqual({ anchor: 'bottom', autofit: 'shrink', insets: { l: 0, t: 2, r: 14.4, b: 7.2 } });
  });

  it('keep the master\'s shapes out of the master\'s elements: only decorations are elements', () => {
    expect(deckOf({ slides: [''] }).master.elements).toEqual([]);
    const withLogo = deckOf({ slides: [''], masterTree: MASTER_TREE + sp({ id: 9, name: 'Logo' }) });
    expect(withLogo.master.elements.map((e) => e.name)).toEqual(['Logo']);
  });

  it('give the layout\'s lstStyle to the layout, by type, and the master\'s txStyles to the master', () => {
    const layoutTree = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000" b="1"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`;
    const d = deckOf({ slides: [''], layoutTree });
    expect(d.layouts[0]!.styles).toEqual({ ctrTitle: [{ align: 'center', fontSize: 60, bold: true }] });
    expect(d.master.styles.title).toMatchObject({ fontSize: 44, color: { theme: 'dk1' }, fontFamily: 'Calibri Light' });
    expect(d.master.styles.body[0]).toMatchObject({ fontSize: 28, indent: 54, bulletIndent: 0, bullet: { kind: 'char', char: '•' } });
    expect(d.master.styles.body[1]).toMatchObject({ fontSize: 24, indent: 117, bulletIndent: 72 });
  });

  it('are kept when empty: a prompt, not nothing', () => {
    const els = firstSlide(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`);
    expect((els[0] as ShapeElement).text).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('text', () => {
  const para1 = (inner: string, pPr = ''): ShapeElement => firstSlide(sp({ body: `<a:p>${pPr}${inner}</a:p>` }))[0] as ShapeElement;

  it('reads a run\'s marks, and joins runs that have the same', () => {
    const e = para1('<a:r><a:rPr b="1"/><a:t>one </a:t></a:r><a:r><a:rPr b="1"/><a:t>two</a:t></a:r><a:r><a:rPr i="1" u="sng" strike="sngStrike" baseline="30000"/><a:t> three</a:t></a:r>');
    const runs = e.text!.content[0]!.content!;
    expect(runs.map((r) => [r.text, r.marks!.map((m) => m.type)])).toEqual([
      ['one two', ['bold']],
      [' three', ['italic', 'underline', 'strike', 'sup']]
    ]);
  });

  it('a subscript is a subscript, and a run with b="0" is not bold', () => {
    const e = para1('<a:r><a:rPr b="0" baseline="-25000"/><a:t>x</a:t></a:r>');
    expect(e.text!.content[0]!.content![0]!.marks!.map((m) => m.type)).toEqual(['sub']);
  });

  it('type: size in points, colour, family, with theme fonts written out', () => {
    const e = para1('<a:r><a:rPr sz="3200"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>x</a:t></a:r><a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr><a:t>y</a:t></a:r><a:r><a:rPr><a:latin typeface="Comic Sans MS"/></a:rPr><a:t>z</a:t></a:r><a:r><a:rPr><a:latin typeface="+mn-ea"/></a:rPr><a:t>w</a:t></a:r>');
    const style = (i: number) => e.text!.content[0]!.content![i]!.marks?.find((m) => m.type === 'textStyle')?.attrs;
    expect(style(0)).toEqual({ color: { theme: 'accent2' }, fontSize: 32, fontFamily: 'Calibri Light' });
    expect(style(1)).toEqual({ fontFamily: 'Calibri' });
    expect(style(2)).toEqual({ fontFamily: 'Comic Sans MS' });
    expect(style(3)).toBeUndefined();
  });

  it('a font name that is not a name is no font', () => {
    const e = para1('<a:r><a:rPr><a:latin typeface="Arial&quot;;}&lt;/style&gt;&lt;script&gt;"/></a:rPr><a:t>x</a:t></a:r>');
    expect(JSON.stringify(e.text)).not.toMatch(/script|style|;/);
  });

  it('a slide-number field is the deck\'s number; a date field is its cached text', () => {
    const e = para1('<a:r><a:t>Page </a:t></a:r><a:fld id="{1}" type="slidenum"><a:rPr/><a:t>7</a:t></a:fld><a:r><a:t> on </a:t></a:r><a:fld id="{2}" type="datetime1"><a:t>1/2/2026</a:t></a:fld>');
    expect(text(e.text)).toBe('Page ‹#› on 1/2/2026');
  });

  it('a break is a hardBreak, and control characters are not text', () => {
    const e = para1('<a:r><a:t>a\u0001b</a:t></a:r><a:br><a:rPr/></a:br><a:r><a:t>c\u007fd</a:t></a:r>'.replace('\u0001', '').replace('\u007f', ''));
    expect(e.text!.content[0]!.content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    const dirty = para1('<a:r><a:t>line one\nline two\r\nline three</a:t></a:r>');
    expect(text(dirty.text)).toBe('line one line two line three');
  });

  it('paragraphs: level, alignment, spacing, line height, and a margin only when the paragraph states one', () => {
    const e = para1('<a:r><a:t>x</a:t></a:r>', '<a:pPr lvl="2" algn="r" marL="457200" indent="-228600"><a:lnSpc><a:spcPct val="80000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="1200"/></a:spcAft></a:pPr>');
    expect(e.text!.content[0]!.attrs).toEqual({ level: 2, align: 'right', spaceBefore: 6, spaceAfter: 12, lineHeight: 0.8, indent: 72, bulletIndent: 36 });
    const plain = para1('<a:r><a:t>x</a:t></a:r>');
    expect(plain.text!.content[0]!.attrs).toBeUndefined();
  });

  it('spacing in percent is a share of the type\'s size', () => {
    const e = para1('<a:r><a:t>x</a:t></a:r>', '<a:pPr><a:spcBef><a:spcPct val="20000"/></a:spcBef></a:pPr>');
    // 20% of an 18 pt line of 1.2: 4.32 pt.
    expect(e.text!.content[0]!.attrs!.spaceBefore).toBeCloseTo(4.32, 2);
  });

  it('bullets: none, a character through its symbol font, numbers, and a colour', () => {
    const b = (pPr: string) => para1('<a:r><a:t>x</a:t></a:r>', `<a:pPr>${pPr}</a:pPr>`).text!.content[0]!.attrs!.bullet;
    expect(b('<a:buNone/>')).toEqual({ kind: 'none' });
    expect(b('<a:buChar char="–"/>')).toEqual({ kind: 'char', char: '–' });
    expect(b('<a:buFont typeface="Wingdings"/><a:buChar char="§"/>')).toEqual({ kind: 'char', char: '▪' });
    expect(b('<a:buFont typeface="Wingdings"/><a:buChar char="Z"/>')).toEqual({ kind: 'char', char: '•' });
    expect(b('<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buChar char="*"/>')).toEqual({ kind: 'char', char: '*', color: '#ff0000' });
    expect(b('<a:buChar char="&lt;"/>')).toEqual({ kind: 'char', char: '•' });
    expect(b('<a:buAutoNum type="arabicParenBoth" startAt="4"/>')).toEqual({ kind: 'number', style: 'arabicParen', start: 4 });
    expect(b('<a:buAutoNum type="somethingNew"/>')).toEqual({ kind: 'number', style: 'arabicPeriod' });
  });

  it('a shape\'s own lstStyle is laid under its paragraphs', () => {
    const e = firstSlide(
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" algn="ctr"><a:buNone/><a:defRPr sz="3000" b="1"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:t>x</a:t></a:r></a:p><a:p><a:pPr algn="l"/><a:r><a:rPr sz="1000"/><a:t>y</a:t></a:r></a:p></p:txBody></p:sp>`
    )[0] as ShapeElement;
    const [a, b] = e.text!.content;
    expect(a!.attrs).toMatchObject({ align: 'center', bullet: { kind: 'none' }, indent: 0 });
    expect(a!.content![0]!.marks!.map((m) => m.type)).toEqual(['bold', 'textStyle']);
    expect(a!.content![0]!.marks![1]!.attrs).toEqual({ color: '#00ff00', fontSize: 30 });
    expect(b!.attrs!.align).toBe('left');
    expect(b!.content![0]!.marks!.find((m) => m.type === 'textStyle')!.attrs).toMatchObject({ fontSize: 10 });
  });

  it('a body: anchor, insets, autofit, wrap, direction', () => {
    const body = (bodyPr: string) => (firstSlide(sp({ body: `<a:p><a:r><a:t>x</a:t></a:r></a:p>` }).replace('<a:bodyPr/>', bodyPr))[0] as ShapeElement).textBox;
    expect(body('<a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:spAutoFit/></a:bodyPr>')).toEqual({ anchor: 'middle', insets: { l: 0, t: 0, r: 0, b: 0 }, autofit: 'grow', wrap: false });
    expect(body('<a:bodyPr vert="vert270"><a:noAutofit/></a:bodyPr>')).toEqual({ autofit: 'none', vertical: true });
    expect(body('<a:bodyPr/>')).toBeUndefined();
  });
});

describe('hyperlinks', () => {
  const link = (target: string, external = true): DeckJSON =>
    deckOf({ slides: [sp({ body: `<a:p><a:r><a:rPr><a:hlinkClick r:id="rId9"/></a:rPr><a:t>x</a:t></a:r></a:p>` })], slideRels: { 1: [{ id: 'rId9', type: 'hyperlink', target, external }] } });
  const marks = (d: DeckJSON) => (d.slides[0]!.elements[0] as ShapeElement).text!.content[0]!.content![0]!.marks?.map((m) => m.type) ?? [];

  it.each(['https://example.com/a?b=c#d', 'http://example.com', 'mailto:a@example.com'])('keeps %s', (href) => {
    expect(marks(link(href))).toEqual(['link']);
  });

  it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'vbscript:x', 'ftp://example.com', 'tel:+1', '//example.com', 'example.com', 'https://exa mple.com', 'https://example.com/\u0001', `https://example.com/${'a'.repeat(3000)}`])('drops %s', (href) => {
    expect(marks(link(href))).toEqual([]);
  });

  it('a jump to another slide is not a link', () => {
    const d = deckOf({
      slides: [sp({ body: `<a:p><a:r><a:rPr><a:hlinkClick r:id="rId9" action="ppaction://hlinksldjump"/></a:rPr><a:t>x</a:t></a:r></a:p>` })],
      slideRels: { 1: [{ id: 'rId9', type: 'slide', target: 'slide1.xml' }] }
    });
    expect(marks(d)).toEqual([]);
  });
});

describe('shapes', () => {
  it('a preset is itself, a near one is the nearest, a freeform is a rectangle', () => {
    const kinds = ['roundRect', 'ellipse', 'flowChartDecision', 'star7', 'mathPlus', 'sun'].map((prst) => (firstSlide(sp({ prst }))[0] as ShapeElement).shape);
    expect(kinds).toEqual(['roundRect', 'ellipse', 'diamond', 'star5', 'plus', 'rect']);
  });

  it('a rounded rectangle keeps its corner as a share of the shorter side', () => {
    const tree = sp({ prst: 'roundRect' }).replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst>');
    expect((firstSlide(tree)[0] as ShapeElement).adjust).toBe(0.5);
    const huge = sp({ prst: 'roundRect' }).replace('<a:avLst/>', '<a:avLst><a:gd name="adj" fmla="val 900000"/></a:avLst>');
    expect((firstSlide(huge)[0] as ShapeElement).adjust).toBe(0.5);
  });

  it('a line is a line, with its ends, flips and dash', () => {
    const tree = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="L"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipH="1" flipV="1"><a:off x="635000" y="635000"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="lgDash"/><a:headEnd type="stealth"/><a:tailEnd type="diamond"/></a:ln></p:spPr></p:cxnSp>`;
    expect(firstSlide(tree)[0]).toEqual({ type: 'line', x: 100, y: 100, w: 200, h: 100, flipH: true, flipV: true, name: 'L', line: { color: '#ff0000', width: 4, dash: 'dash', head: 'triangle', tail: 'oval' } });
  });

  it('a hidden shape is not read, and a shape with no place is at the origin with no size', () => {
    const hidden = sp({}).replace('<p:cNvPr id="10" name="Shape 10"/>', '<p:cNvPr id="10" name="Shape 10" hidden="1"/>');
    expect(firstSlide(hidden + sp({ id: 11 }))).toHaveLength(1);
  });

  it('rotation and flips; alt text and names, cleaned', () => {
    const tree = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="  A name&#10;with a break " descr="Alt"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="2700000" flipH="1"><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
    const e = firstSlide(tree)[0]!;
    expect(e).toMatchObject({ rot: 45, flipH: true, name: 'A name with a break', alt: 'Alt' });
  });

  it('a shadow is a shadow', () => {
    const e = firstSlide(sp({ extra: '<a:effectLst><a:outerShdw blurRad="50800"/></a:effectLst>' }))[0] as ShapeElement;
    expect(e.shadow).toBe(true);
  });

  it('a shape that states no fill has none, and a style gives it the theme\'s', () => {
    expect((firstSlide(sp({}))[0] as ShapeElement).fill).toEqual({ kind: 'none' });
    const styled = sp({}).replace('</p:sp>', '<p:style><a:lnRef idx="1"><a:schemeClr val="accent3"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent3"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent3"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style></p:sp>');
    const e = firstSlide(styled)[0] as ShapeElement;
    expect(e.fill).toEqual({ kind: 'solid', color: { theme: 'accent3' } });
    expect(e.line).toEqual({ color: { theme: 'accent3' }, width: 1 });
  });
});

describe('groups', () => {
  const group = (inner: string, xfrm: string): string => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm ${xfrm.split('|')[0]}>${xfrm.split('|')[1]}</a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
  const child = sp({ x: 0, y: 0, cx: 635000, cy: 635000 });

  it('carries children to slide coordinates through the group\'s scale and offset', () => {
    const g = firstSlide(group(child, '|<a:off x="1270000" y="635000"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="635000" cy="635000"/>'))[0] as GroupElement;
    expect([g.x, g.y, g.w, g.h]).toEqual([200, 100, 200, 200]);
    const c = g.children[0]!;
    expect([c.x, c.y, c.w, c.h]).toEqual([200, 100, 200, 200]);
  });

  it('a group that rotates carries its children round its centre', () => {
    // A 100 x 100 px square at the top-left of a 200 x 200 group turned a quarter: it is at the top-right.
    const g = firstSlide(group(sp({ x: 0, y: 0, cx: 635000, cy: 635000 }), 'rot="5400000"|<a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/>'))[0] as GroupElement;
    const c = g.children[0]!;
    expect(c.rot).toBe(90);
    expect(c.x).toBeCloseTo(100, 1);
    expect(c.y).toBeCloseTo(0, 1);
  });

  it('an empty group is nothing', () => {
    expect(firstSlide(group('', '|<a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/>'))).toEqual([]);
  });

  it('a group with no transform of its own keeps its children where they are, and is their bounds', () => {
    const tree = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${sp({ x: 635000, y: 635000, cx: 635000, cy: 635000 })}${sp({ id: 11, x: 1905000, y: 1905000, cx: 635000, cy: 635000 })}</p:grpSp>`;
    const g = firstSlide(tree)[0] as GroupElement;
    expect([g.x, g.y, g.w, g.h]).toEqual([100, 100, 300, 300]);
  });
});

describe('pictures', () => {
  const pic = (embed: string, extra = '', xfrm = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="635000" cy="635000"/></a:xfrm>') =>
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="P" descr="A picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${embed}"/>${extra}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const withPng = (tree: string, bytes: Uint8Array = PNG_1PX) =>
    readPptx(makePptx({ slides: [tree], slideRels: { 1: [{ id: 'rId5', type: 'image', target: '../media/image1.png' }] }, files: { 'ppt/media/image1.png': bytes } }));

  it('is its bytes: PNG, JPEG, GIF and WebP stay, whatever the name says', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const gif = Uint8Array.from([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    const webp = Uint8Array.from([...new TextEncoder().encode('RIFF'), 12, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 '), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(withPng(pic('rId5'), jpeg).deck.slides[0]!.elements[0]).toMatchObject({ type: 'image', asset: { mime: 'image/jpeg' } });
    expect(withPng(pic('rId5'), gif).deck.slides[0]!.elements[0]).toMatchObject({ asset: { mime: 'image/gif' } });
    expect(withPng(pic('rId5'), webp).deck.slides[0]!.elements[0]).toMatchObject({ asset: { mime: 'image/webp' } });
  });

  it('is base64 of its bytes, and the same picture used twice is one object', () => {
    const r = withPng(pic('rId5') + pic('rId5').replace('id="2"', 'id="3"'));
    const [a, b] = r.deck.slides[0]!.elements as { asset: { data: string } }[];
    expect(atob(a!.asset.data)).toEqual(String.fromCharCode(...PNG_1PX));
    expect(a!.asset).toBe(b!.asset);
  });

  it('is left out when it is not a picture, and says so', () => {
    const r = withPng(pic('rId5'), new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(r.deck.slides[0]!.elements).toEqual([]);
    expect(r.warnings).toEqual(['1 picture in a format that cannot be shown (EMF, WMF, SVG or TIFF) was left out.']);
    const text = withPng(pic('rId5'), new TextEncoder().encode('MZ\u0090 this is not a picture'));
    expect(text.warnings).toEqual(['1 picture that is not a picture file was left out.']);
  });

  it('is left out when its header asks for more pixels than a browser can hold', () => {
    // A 1x1 PNG whose IHDR says 100000 x 100000.
    const bomb = PNG_1PX.slice();
    new DataView(bomb.buffer).setUint32(16, 100000);
    new DataView(bomb.buffer).setUint32(20, 100000);
    const r = withPng(pic('rId5'), bomb);
    expect(r.deck.slides[0]!.elements).toEqual([]);
    expect(r.warnings).toEqual(['1 picture with more pixels than can be shown was left out.']);
  });

  it('is crop, in fractions, clamped', () => {
    const r = withPng(pic('rId5', '<a:srcRect l="25000" t="-5000" r="100000" b="10000"/>'));
    // r takes it to 100%: a crop that leaves nothing is no crop.
    expect((r.deck.slides[0]!.elements[0] as { crop?: unknown }).crop).toBeUndefined();
    const ok = withPng(pic('rId5', '<a:srcRect l="25000" t="-5000" b="10000"/>'));
    expect((ok.deck.slides[0]!.elements[0] as { crop?: unknown }).crop).toEqual({ l: 0.25, t: 0, r: 0, b: 0.1 });
  });

  it('a picture a relationship names outside the file is not followed', () => {
    const r = readPptx(makePptx({ slides: [pic('rId5')], slideRels: { 1: [{ id: 'rId5', type: 'image', target: 'https://example.com/x.png', external: true }] } }));
    expect(r.deck.slides[0]!.elements).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/linked from outside the file/);
    const climb = readPptx(makePptx({ slides: [pic('rId5')], slideRels: { 1: [{ id: 'rId5', type: 'image', target: '../../../../../../etc/passwd' }] } }));
    expect(climb.deck.slides[0]!.elements).toEqual([]);
  });

  it('more than a presentation holds are left out, once', () => {
    const slides: string[] = [];
    const files: Record<string, Uint8Array> = {};
    const rels: Record<number, { id: string; type: string; target: string }[]> = {};
    for (let i = 1; i <= 3; i++) {
      slides.push(pic('rId5'));
      rels[i] = [{ id: 'rId5', type: 'image', target: `../media/image${i}.png` }];
      files[`ppt/media/image${i}.png`] = PNG_1PX;
    }
    const r = readPptx(makePptx({ slides, slideRels: rels, files }));
    expect(r.deck.slides.map((s) => s.elements.length)).toEqual([1, 1, 1]);
  });
});

describe('tables', () => {
  const cell = (t: string, attrs = '') => `<a:tc ${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
  const table = (cols: number[], rows: string[]): string =>
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${cols.map((w) => `<a:gridCol w="${w}"/>`).join('')}</a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

  it('a row with fewer cells than the grid is padded, one with more is cut', () => {
    const t = firstSlide(table([635000, 635000], [`<a:tr h="635000">${cell('a')}</a:tr>`, `<a:tr h="635000">${cell('a')}${cell('b')}${cell('c')}</a:tr>`]))[0] as TableElement;
    expect(t.rows.map((r) => r.cells.length)).toEqual([2, 2]);
    expect(t.rows[0]!.cells[1]!.text).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('is the size of its grid, whatever the frame says', () => {
    const t = firstSlide(table([635000, 1270000], [`<a:tr h="317500">${cell('a')}${cell('b')}</a:tr>`]))[0] as TableElement;
    expect([t.w, t.h, t.cols]).toEqual([300, 50, [100, 200]]);
  });

  it('past the cell limit the rest of the rows are left out, and it says so', () => {
    const rows = Array.from({ length: 60 }, () => `<a:tr h="100000">${Array.from({ length: 50 }, () => cell('x')).join('')}</a:tr>`);
    const r = readPptx(makePptx({ slides: [table(Array.from({ length: 50 }, () => 100000), rows)] }));
    const t = r.deck.slides[0]!.elements[0] as TableElement;
    expect(t.rows.length * t.cols.length).toBeLessThanOrEqual(2500);
    expect(t.rows.length).toBe(50);
    expect(r.warnings).toEqual(['1 table past 2500 cells was cut short.']);
  });

  it('a table with no rows or no columns is nothing', () => {
    expect(firstSlide(table([], ['<a:tr h="1"/>']))).toEqual([]);
    expect(firstSlide(table([100], []))).toEqual([]);
  });
});

describe('charts', () => {
  const chart = (inner: string): string => `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>${inner}</c:chart></c:chartSpace>`;
  const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="C"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6350000" cy="3175000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId7"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const read = (xml: string) =>
    readPptx(makePptx({ slides: [frame], slideRels: { 1: [{ id: 'rId7', type: 'chart', target: '../charts/chart1.xml' }] }, files: { 'ppt/charts/chart1.xml': xml } }));
  const ser = (name: string, cats: string, vals: string): string => `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>x</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>${cats}${vals}</c:ser>`;
  const cat = (xs: string[]) => `<c:cat><c:strRef><c:f>x</c:f><c:strCache><c:ptCount val="${xs.length}"/>${xs.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
  const val = (xs: (number | null)[]) => `<c:val><c:numRef><c:f>x</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${xs.length}"/>${xs.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:val>`;

  it('is its kind, categories and values, from the cache', () => {
    const c = read(chart(`<c:plotArea><c:barChart><c:barDir val="col"/>${ser('Sales', cat(['a', 'b']), val([1, 2.5]))}</c:barChart></c:plotArea>`)).deck.slides[0]!.elements[0] as ChartElement;
    expect(c).toMatchObject({ type: 'chart', chart: 'column', categories: ['a', 'b'], series: [{ name: 'Sales', values: [1, 2.5] }], x: 0, w: 1000, h: 500 });
  });

  it('a point missing from the cache is zero, a literal is read like a reference, a missing category is its number', () => {
    const lit = `<c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>one</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="3"/><c:pt idx="1"><c:v>5</c:v></c:pt></c:numLit></c:val>`;
    const c = read(chart(`<c:plotArea><c:lineChart>${ser('L', '', lit).replace('<c:tx>', '<c:tx>')}</c:lineChart></c:plotArea>`)).deck.slides[0]!.elements[0] as ChartElement;
    expect(c.categories).toEqual(['one', '', '3']);
    expect(c.series[0]!.values).toEqual([0, 5, 0]);
  });

  it('the kinds: bar, line, pie, scatter; area, doughnut and bubble as the nearest', () => {
    const kind = (group: string) => (read(chart(`<c:plotArea>${group}</c:plotArea>`)).deck.slides[0]!.elements[0] as ChartElement | undefined)?.chart;
    const s = ser('S', cat(['a']), val([1]));
    expect(kind(`<c:barChart><c:barDir val="bar"/>${s}</c:barChart>`)).toBe('bar');
    expect(kind(`<c:lineChart>${s}</c:lineChart>`)).toBe('line');
    expect(kind(`<c:areaChart>${s}</c:areaChart>`)).toBe('line');
    expect(kind(`<c:pieChart>${s}</c:pieChart>`)).toBe('pie');
    expect(kind(`<c:doughnutChart>${s}</c:doughnutChart>`)).toBe('pie');
    expect(kind(`<c:scatterChart>${s.replace('<c:cat>', '<c:xVal>').replace('</c:cat>', '</c:xVal>').replace('<c:val>', '<c:yVal>').replace('</c:val>', '</c:yVal>')}</c:scatterChart>`)).toBe('scatter');
    expect(kind(`<c:radarChart>${s}</c:radarChart>`)).toBeUndefined();
  });

  it('keeps the first kind of a chart of two, the title, and a series\' colour', () => {
    const r = read(
      chart(`<c:title><c:tx><c:rich><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>chart</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:barChart><c:barDir val="col"/>${ser('A', cat(['a']), val([1])).replace('</c:tx>', '</c:tx><c:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></c:spPr>')}</c:barChart><c:lineChart>${ser('B', cat(['a']), val([2]))}</c:lineChart></c:plotArea>`)
    );
    const c = r.deck.slides[0]!.elements[0] as ChartElement;
    expect(c.title).toBe('Hello chart');
    expect(c.series.map((s) => s.name)).toEqual(['A']);
    expect(c.series[0]!.color).toBe('#ff0000');
    expect(r.warnings).toEqual(['1 chart of more than one kind kept only the first kind\'s series.']);
  });

  it('categories in levels are named by the innermost; stacking is said, not drawn', () => {
    const multi = `<c:cat><c:multiLvlStrRef><c:f>x</c:f><c:multiLvlStrCache><c:ptCount val="2"/><c:lvl><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v>2026</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>`;
    const r = read(chart(`<c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>${ser('S', multi, val([1, 2]))}</c:barChart></c:plotArea>`));
    expect((r.deck.slides[0]!.elements[0] as ChartElement).categories).toEqual(['Jan', 'Feb']);
    expect(r.warnings).toEqual(['1 stacked chart is drawn side by side.']);
  });

  it('a chart part that is not there is said, not drawn', () => {
    const r = readPptx(makePptx({ slides: [frame], slideRels: { 1: [{ id: 'rId7', type: 'chart', target: '../charts/gone.xml' }] } }));
    expect(r.deck.slides[0]!.elements).toEqual([]);
    expect(r.warnings).toEqual(['1 chart could not be read and was left out.']);
  });
});

describe('what a bad part costs', () => {
  const twoSlides = (over: Record<string, string | Uint8Array>) => makePptx({ slides: [sp({ body: para('one') }), sp({ body: para('two') }), sp({ body: para('three') })], files: over });

  it('a slide that is not XML is still a slide: blank, on its layout, said', () => {
    const r = readPptx(twoSlides({ 'ppt/slides/slide2.xml': '<p:sld><p:cSld>broken' }));
    expect(r.deck.slides.map((s) => s.elements.length)).toEqual([1, 0, 1]);
    expect(r.deck.slides[1]!.layout).toBe(r.deck.layouts[0]!.id);
    expect(r.warnings).toEqual(['1 slide could not be read and is blank.']);
  });

  it('a slide the list names and the package does not hold is still a slide', () => {
    const files = unzipSync(twoSlides({}));
    delete files['ppt/slides/slide2.xml'];
    delete files['ppt/slides/_rels/slide2.xml.rels'];
    const r = readPptx(zipSync(files));
    expect(r.deck.slides.length).toBe(3);
    expect(r.deck.slides.map((s) => s.elements.length)).toEqual([1, 0, 1]);
    expect(r.warnings).toEqual(['1 slide could not be read and is blank.']);
  });

  it('a DOCTYPE anywhere refuses the file; it is not a bad part', () => {
    const e = refusal(() => readPptx(twoSlides({ 'ppt/slides/slide2.xml': '<!DOCTYPE x [<!ENTITY a "b">]><p:sld xmlns:p="x"/>' })));
    expect(e.code).toBe('xml_unsafe');
  });

  it('a presentation with no slides is a deck with none, and says so', () => {
    const r = readPptx(makePptx({ slides: [] }));
    expect(r.deck.slides).toEqual([]);
    expect(r.deck.layouts.length).toBe(1);
    expect(r.warnings).toEqual(['The presentation has no slides.']);
  });

  it('a slide whose layout is missing takes the first layout', () => {
    const files = { 'ppt/slides/_rels/slide1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' };
    const r = readPptx(makePptx({ slides: [sp({})], files }));
    expect(r.deck.slides[0]!.layout).toBe(r.deck.layouts[0]!.id);
  });

  it('a presentation with no master still reads its slides', () => {
    const bytes = makePptx({ slides: [sp({ body: para('hi') })], files: { 'ppt/slides/_rels/slide1.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>', 'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>' } });
    const r = readPptx(bytes);
    expect(r.deck.slides.length).toBe(1);
    expect(r.deck.layouts.length).toBe(1);
  });
});

describe('what is not read is said', () => {
  it('animations and comments', () => {
    const r = readPptx(
      makePptx({
        slides: [sp({}), sp({})],
        slideAfter: { 1: '<p:timing><p:tnLst><p:par/></p:tnLst></p:timing>' },
        slideRels: { 2: [{ id: 'rId8', type: 'comments', target: '../comments/comment1.xml' }] }
      })
    );
    expect(r.warnings).toEqual(['1 slide with animations was read without them.', '1 slide with comments was read without them.']);
  });
});

describe('limits', () => {
  it('more slides than a deck holds is refused', () => {
    const slides = Array.from({ length: 501 }, () => '');
    expect(refusal(() => readPptx(makePptx({ slides }))).code).toBe('deck_too_large');
    expect(readPptx(makePptx({ slides: Array.from({ length: 500 }, () => '') })).deck.slides.length).toBe(500);
  });

  it('more text than a deck can hold is refused', () => {
    const big = 'x'.repeat(1_000_000);
    const slides = Array.from({ length: 5 }, () => sp({ body: para(big) }));
    expect(refusal(() => readPptx(makePptx({ slides }))).code).toBe('deck_too_large');
  });

  it('more elements than a slide holds are left out, and said once', () => {
    const r = readPptx(makePptx({ slides: [Array.from({ length: 450 }, (_, i) => sp({ id: i + 2 })).join('')] }));
    expect(r.deck.slides[0]!.elements.length).toBe(400);
    expect(r.warnings).toEqual(['50 shapes past the 400 a slide can hold were left out.']);
  });

  it('a name and an alt text are cut to 200 characters', () => {
    const e = firstSlide(sp({ name: 'n'.repeat(900) }))[0]!;
    expect(e.name!.length).toBe(200);
  });
});

void NS;
void GROUP_HEAD;
void LAYOUT_TREE;
void solid;
