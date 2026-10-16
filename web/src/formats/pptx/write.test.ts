import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AssetRef, DeckJSON, ElementJSON, LayoutJSON, SlideJSON, TextDoc } from '../../slides/model/deck';
import { PNG_1PX } from '../testing';
import { makePptx, sp } from './testing';
import { parsePart } from './part';
import { readPptx } from './read';
import { writePptx, writePptxReport } from './write';
import { child, descendants, elements } from '../xml';

const THEME = {
  id: 'office',
  name: 'Office',
  colors: { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1' },
  fonts: { major: 'Georgia', minor: 'Verdana' }
};

const doc = (...paras: (string | { runs: { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[]; attrs?: Record<string, unknown> })[]): TextDoc => ({
  type: 'doc',
  content: paras.map((p) =>
    typeof p === 'string'
      ? { type: 'paragraph', ...(p ? { content: [{ type: 'text', text: p }] } : {}) }
      : { type: 'paragraph', ...(p.attrs ? { attrs: p.attrs } : {}), content: p.runs.map((r) => ({ type: 'text', text: r.text, ...(r.marks ? { marks: r.marks } : {}) })) }
  )
});

const placeholder = (type: 'title' | 'body' | 'subTitle' | 'ctrTitle' | 'dt' | 'ftr' | 'sldNum', idx: number | undefined, y = 0, text = 'Prompt'): ElementJSON => ({
  type: 'shape',
  shape: 'rect',
  x: 100,
  y,
  w: 800,
  h: 100,
  ph: idx === undefined ? { type } : { type, idx },
  fill: { kind: 'none' },
  text: doc(text)
});

const LAYOUT: LayoutJSON = { id: 'content', name: 'Title and content', elements: [placeholder('title', undefined, 50), placeholder('body', 1, 200), placeholder('sldNum', 12, 900, '‹#›')] };

const deck = (slides: SlideJSON[], over: Partial<DeckJSON> = {}): DeckJSON => ({
  v: 1,
  size: '16:9',
  theme: THEME,
  master: { elements: [], styles: { title: { fontSize: 44, fontFamily: 'Georgia' }, body: [{ fontSize: 28, fontFamily: 'Verdana', bullet: { kind: 'char', char: '•' }, indent: 54, bulletIndent: 0 }], other: { fontSize: 18 } } },
  layouts: [LAYOUT],
  slides,
  ...over
});

const rect = (over: Record<string, unknown> = {}): ElementJSON => ({ type: 'shape', shape: 'rect', x: 10, y: 20, w: 300, h: 100, fill: { kind: 'none' }, ...over }) as ElementJSON;

const noAssets = async (): Promise<null> => null;

async function parts(d: DeckJSON, getAsset: (ref: AssetRef) => Promise<{ bytes: Uint8Array; mime: string } | null> = noAssets): Promise<Record<string, string>> {
  const files = unzipSync(await writePptx(d, getAsset));
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, /\.(?:xml|rels)$/.test(k) ? strFromU8(v) : `[${v.length} bytes]`]));
}

describe('the package is sound', () => {
  const full = (): DeckJSON =>
    deck(
      [
        {
          layout: 'content',
          elements: [
            placeholder('title', undefined, 50, 'T'),
            rect({ text: doc('a & b <c>'), fill: { kind: 'solid', color: { theme: 'accent1', lum: 0.4 } } }),
            { type: 'line', x: 0, y: 0, w: 100, h: 50, line: { color: '#ff0000', width: 2, head: 'oval', tail: 'triangle', dash: 'dash' } },
            { type: 'table', x: 0, y: 0, w: 200, h: 100, cols: [100, 100], rows: [{ h: 50, cells: [{ text: doc('a'), colSpan: 2 }, { text: doc(''), merged: true }] }, { h: 50, cells: [{ text: doc('c') }, { text: doc('d') }] }], firstRow: true },
            { type: 'chart', x: 0, y: 0, w: 400, h: 300, chart: 'column', categories: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }], title: 'Chart' },
            { type: 'image', x: 0, y: 0, w: 100, h: 100, asset: { id: 'a1' } },
            { type: 'group', x: 0, y: 0, w: 100, h: 100, children: [rect({ x: 0, y: 0 })] }
          ],
          notes: doc('Say this'),
          transition: { kind: 'push', from: 'left', duration: 800 },
          hidden: true
        },
        { layout: 'content', elements: [] }
      ]
    );

  it('every part is XML our reader would accept, has a content type, and every relationship has a target', async () => {
    const files = await parts(full(), async () => ({ bytes: PNG_1PX, mime: 'image/png' }));
    const names = Object.keys(files);
    for (const [name, text] of Object.entries(files)) if (/\.(?:xml|rels)$/.test(name)) expect(() => parsePart(text), name).not.toThrow();
    const ct = parsePart(files['[Content_Types].xml']!);
    const defaults = new Set(elements(ct).filter((e) => e.name === 'ct:Default').map((e) => e.attrs.Extension!.toLowerCase()));
    const overrides = new Set(elements(ct).filter((e) => e.name === 'ct:Override').map((e) => e.attrs.PartName));
    for (const n of names) {
      if (n === '[Content_Types].xml') continue;
      expect(overrides.has(`/${n}`) || defaults.has(n.split('.').pop()!.toLowerCase()), `${n} has a content type`).toBe(true);
    }
    for (const o of overrides) expect(names.includes(o!.slice(1)), `${o} is a part`).toBe(true);
    for (const n of names.filter((x) => x.endsWith('.rels'))) {
      const base = n.replace(/_rels\/[^/]+$/, '');
      for (const r of elements(parsePart(files[n]!)).filter((e) => e.name === 'rel:Relationship')) {
        if (r.attrs.TargetMode === 'External') continue;
        const target = r.attrs.Target!;
        const parts2 = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
        const out: string[] = [];
        for (const p of parts2) p === '..' ? out.pop() : p !== '.' && out.push(p);
        expect(names, `${n}: ${r.attrs.Id} to ${target}`).toContain(out.join('/'));
      }
    }
  });

  it('a shape id is used once in a part', async () => {
    const files = await parts(full(), async () => ({ bytes: PNG_1PX, mime: 'image/png' }));
    for (const [name, text] of Object.entries(files).filter(([n]) => /^ppt\/(?:slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n))) {
      const ids = descendants(parsePart(text), 'p:cNvPr').map((n) => n.attrs.id);
      expect(new Set(ids).size, `${name}: ${ids.join(',')}`).toBe(ids.length);
    }
  });

  it('an empty deck is still a deck: one blank layout, no slides', async () => {
    const r = readPptx(await writePptx({ v: 1, size: '16:9', theme: THEME, master: { elements: [], styles: { title: {}, body: [], other: {} } }, layouts: [], slides: [] }, noAssets));
    expect(r.deck.slides).toEqual([]);
    expect(r.deck.layouts.map((l) => l.name)).toEqual(['Blank']);
  });

  it('is the same bytes for the same deck, and says its title', async () => {
    const a = await writePptx(full(), noAssets, { title: 'Quarterly' });
    const b = await writePptx(full(), noAssets, { title: 'Quarterly' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(readPptx(a).title).toBe('Quarterly');
  });

  it('is sized as PowerPoint sizes its presets', async () => {
    const size = async (s: DeckJSON['size']) => {
      const p = parsePart((await parts(deck([], { size: s })))['ppt/presentation.xml']!);
      const sz = child(p, 'p:sldSz')!;
      return [Number(sz.attrs.cx), Number(sz.attrs.cy)];
    };
    expect(await size('16:9')).toEqual([12192000, 6858000]);
    expect(await size('4:3')).toEqual([9144000, 6858000]);
    expect(await size('16:10')).toEqual([9144000, 5715000]);
  });
});

describe('what is written for what the deck says', () => {
  const slideXml = async (elements: ElementJSON[], over: Partial<SlideJSON> = {}, d: Partial<DeckJSON> = {}): Promise<string> => (await parts(deck([{ layout: 'content', elements, ...over }], d)))['ppt/slides/slide1.xml']!;

  it('a theme colour is a scheme colour with its tint, never the hex it resolves to', async () => {
    const xml = await slideXml([
      rect({ fill: { kind: 'solid', color: { theme: 'accent1', lum: 0.4 } } }),
      rect({ fill: { kind: 'solid', color: { theme: 'accent2', lum: -0.25 } } }),
      rect({ fill: { kind: 'solid', color: { theme: 'dk1' } } }),
      rect({ fill: { kind: 'solid', color: { theme: 'lt2', alpha: 0.5 } } })
    ]);
    expect(xml).toContain('<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>');
    expect(xml).toContain('<a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr>');
    expect(xml).toContain('<a:schemeClr val="tx1"/>');
    expect(xml).toContain('<a:schemeClr val="bg2"><a:alpha val="50000"/></a:schemeClr>');
    expect(xml).not.toMatch(/4472C4|ED7D31/i);
  });

  it('a hex colour is hex, with its alpha', async () => {
    const xml = await slideXml([rect({ fill: { kind: 'solid', color: '#112233', alpha: 0.4 } }), rect({ fill: { kind: 'gradient', angle: 90, stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: { theme: 'accent1' } }] } })]);
    expect(xml).toContain('<a:srgbClr val="112233"><a:alpha val="40000"/></a:srgbClr>');
    expect(xml).toContain('<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent1"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>');
  });

  it('a placeholder is written with the idx of the layout placeholder it matches', async () => {
    const xml = await slideXml([placeholder('title', undefined), placeholder('body', undefined, 200), placeholder('sldNum', undefined, 900)]);
    const phs = descendants(parsePart(xml), 'p:ph').map((p) => ({ ...p.attrs }));
    expect(phs).toEqual([{ type: 'title' }, { type: 'body', idx: '1' }, { type: 'sldNum', sz: 'quarter', idx: '12' }]);
  });

  it('a placeholder the layout does not have keeps the idx it has', async () => {
    const xml = await slideXml([placeholder('body', 7)]);
    expect(descendants(parsePart(xml), 'p:ph')[0]!.attrs).toEqual({ type: 'body', idx: '1' });
    const none = await slideXml([placeholder('ftr', 7)]);
    expect(descendants(parsePart(none), 'p:ph')[0]!.attrs.idx).toBe('7');
  });

  it('two content placeholders on a layout are two idx values, in order', async () => {
    const two: LayoutJSON = { id: 'two', name: 'Two', elements: [placeholder('title', undefined), placeholder('body', 1, 100), placeholder('body', 2, 200)] };
    const files = await parts(deck([{ layout: 'two', elements: [placeholder('body', 2, 200), placeholder('body', 1, 100)] }], { layouts: [two] }));
    expect(descendants(parsePart(files['ppt/slideLayouts/slideLayout1.xml']!), 'p:ph').map((p) => p.attrs.idx)).toEqual([undefined, '1', '2']);
    expect(descendants(parsePart(files['ppt/slides/slide1.xml']!), 'p:ph').map((p) => p.attrs.idx)).toEqual(['2', '1']);
  });

  it('the layout keeps its name, its prompts and its text styles', async () => {
    const files = await parts(deck([], { layouts: [{ ...LAYOUT, styles: { body: [{ fontSize: 30, bullet: { kind: 'none' } }] } }] }));
    const xml = files['ppt/slideLayouts/slideLayout1.xml']!;
    expect(xml).toContain('<p:cSld name="Title and content">');
    expect(xml).toContain('<a:t>Prompt</a:t>');
    expect(xml).toContain('<a:lvl1pPr><a:buNone/><a:defRPr sz="3000"/></a:lvl1pPr>');
  });

  it('a master hidden from a layout and from a slide says so', async () => {
    const files = await parts(deck([{ layout: 'content', elements: [], showMaster: false }], { layouts: [{ ...LAYOUT, showMaster: false }] }));
    expect(files['ppt/slideLayouts/slideLayout1.xml']).toContain('showMasterSp="0"');
    expect(files['ppt/slides/slide1.xml']).toContain('showMasterSp="0"');
  });

  it('text: marks, sizes, fonts, and the characters XML cannot hold', async () => {
    const t = doc({ runs: [{ text: 'bold', marks: [{ type: 'bold' }, { type: 'underline' }, { type: 'textStyle', attrs: { fontSize: 20, color: '#ff0000', fontFamily: 'Georgia' } }] }, { text: ' sub', marks: [{ type: 'sub' }, { type: 'strike' }, { type: 'italic' }] }, { text: ' <&> \u0001\u0008 ok', marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }] }] });
    const xml = await slideXml([rect({ text: t })]);
    expect(xml).toContain('<a:rPr lang="en-US" sz="2000" b="1" u="sng"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>bold</a:t>');
    expect(xml).toContain('<a:rPr lang="en-US" i="1" strike="sngStrike" baseline="-25000"/>');
    expect(xml).toContain('<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>');
    expect(xml).toContain('<a:t> &lt;&amp;&gt;  ok</a:t>');
    expect(() => parsePart(xml)).not.toThrow();
  });

  it('text: paragraph properties, in the order the schema wants them', async () => {
    const t = doc({ runs: [{ text: 'x' }], attrs: { align: 'center', level: 2, lineHeight: 0.9, spaceBefore: 6, spaceAfter: 12, bullet: { kind: 'number', style: 'alphaLcPeriod', start: 3 }, indent: 72, bulletIndent: 36 } });
    const xml = await slideXml([rect({ text: t })]);
    expect(xml).toContain('<a:pPr marL="457200" indent="-228600" lvl="2" algn="ctr"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="1200"/></a:spcAft><a:buFont typeface="+mj-lt"/><a:buAutoNum type="alphaLcPeriod" startAt="3"/></a:pPr>');
  });

  it('a slide-number text is the field PowerPoint renumbers, with this slide\'s number cached', async () => {
    const files = await parts(deck([{ layout: 'content', elements: [] }, { layout: 'content', elements: [rect({ text: doc('Page ‹#› of many') })] }]));
    expect(files['ppt/slides/slide2.xml']).toContain('<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>2</a:t></a:fld>');
    expect(files['ppt/slides/slide2.xml']).toContain('<a:t>Page </a:t>');
    expect(files['ppt/slides/slide2.xml']).toContain('<a:t> of many</a:t>');
  });

  it('a link is written when it is a web or mail address, and the text stays when it is not', async () => {
    const t = doc({ runs: [{ text: 'good', marks: [{ type: 'link', attrs: { href: 'https://example.com/a?b=1&c=2' } }] }, { text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] });
    const files = await parts(deck([{ layout: 'content', elements: [rect({ text: t })] }]));
    expect(files['ppt/slides/slide1.xml']).toContain('<a:hlinkClick r:id="rId2"/>');
    expect(files['ppt/slides/slide1.xml']).toContain('<a:t>bad</a:t>');
    expect(files['ppt/slides/_rels/slide1.xml.rels']).toContain('Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"');
    expect(files['ppt/slides/_rels/slide1.xml.rels']).not.toContain('javascript');
  });

  it('type on a 4:3 deck is scaled back to the slide it is on', async () => {
    const files = await parts(deck([{ layout: 'content', elements: [rect({ text: doc({ runs: [{ text: 'x', marks: [{ type: 'textStyle', attrs: { fontSize: 26.5 } }] }] }) })] }], { size: '4:3' }));
    // 26.5 on the deck's 13.33 in slide is 20 pt on a 10 in one.
    expect(files['ppt/slides/slide1.xml']).toContain('sz="2000"');
  });

  it('a line, with its flips and ends', async () => {
    const xml = await slideXml([{ type: 'line', x: 10, y: 20, w: 100, h: 50, flipH: true, line: { color: '#00ff00', width: 3, head: 'arrow', tail: 'oval', dash: 'dot' } }]);
    expect(xml).toContain('<a:xfrm flipH="1"><a:off x="63500" y="127000"/><a:ext cx="635000" cy="317500"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="sysDot"/><a:headEnd type="arrow" w="med" len="med"/><a:tailEnd type="oval" w="med" len="med"/></a:ln>');
  });

  it('a rotated shape, a rounded one and a shadow', async () => {
    const xml = await slideXml([rect({ shape: 'roundRect', adjust: 0.25, rot: 30, flipV: true, shadow: true })]);
    expect(xml).toContain('<a:xfrm rot="1800000" flipV="1">');
    expect(xml).toContain('<a:gd name="adj" fmla="val 25000"/>');
    expect(xml).toContain('<a:outerShdw');
  });

  it('a table: grid, spans and the cells they cover', async () => {
    const xml = await slideXml([
      {
        type: 'table',
        x: 0,
        y: 0,
        w: 300,
        h: 150,
        cols: [100, 100, 100],
        rows: [
          { h: 50, cells: [{ text: doc('a'), colSpan: 2, rowSpan: 2 }, { text: doc(''), merged: true }, { text: doc('c') }] },
          { h: 50, cells: [{ text: doc(''), merged: true }, { text: doc(''), merged: true }, { text: doc('f') }] }
        ]
      }
    ]);
    const tcs = descendants(parsePart(xml), 'a:tc').map((c) => ({ ...c.attrs }));
    expect(tcs).toEqual([{ gridSpan: '2', rowSpan: '2' }, { hMerge: '1' }, {}, { vMerge: '1' }, { hMerge: '1', vMerge: '1' }, {}]);
    expect(xml).toContain('<a:gridCol w="635000"/>');
  });

  it('a group is written with the identity transform, so its children stay where the deck has them', async () => {
    const xml = await slideXml([{ type: 'group', x: 100, y: 100, w: 300, h: 200, rot: 45, flipH: true, children: [rect({ x: 150, y: 150, w: 50, h: 50 })] }]);
    const g = descendants(parsePart(xml), 'p:grpSp')[0]!;
    const x = child(child(g, 'p:grpSpPr'), 'a:xfrm')!;
    expect(x.attrs).toEqual({});
    expect(child(x, 'a:off')!.attrs).toEqual(child(x, 'a:chOff')!.attrs);
    expect(child(x, 'a:ext')!.attrs).toEqual({ cx: child(x, 'a:chExt')!.attrs.cx, cy: child(x, 'a:chExt')!.attrs.cy });
  });

  it('notes: a notes slide, a notes master and its theme, and only when there are notes', async () => {
    const withNotes = await parts(deck([{ layout: 'content', elements: [], notes: doc('First', 'Second') }]));
    expect(Object.keys(withNotes)).toEqual(expect.arrayContaining(['ppt/notesSlides/notesSlide1.xml', 'ppt/notesMasters/notesMaster1.xml', 'ppt/theme/theme2.xml']));
    expect(withNotes['ppt/notesSlides/notesSlide1.xml']).toContain('<a:t>First</a:t>');
    expect(withNotes['ppt/presentation.xml']).toContain('<p:notesMasterIdLst>');
    const without = await parts(deck([{ layout: 'content', elements: [], notes: doc('') }, { layout: 'content', elements: [] }]));
    expect(Object.keys(without).some((n) => n.includes('notes'))).toBe(false);
  });

  it('a hidden slide, and transitions with and without a time', async () => {
    const files = await parts(
      deck([
        { layout: 'content', elements: [], hidden: true },
        { layout: 'content', elements: [], transition: { kind: 'fade' } },
        { layout: 'content', elements: [], transition: { kind: 'wipe', from: 'bottom', duration: 1200 } },
        { layout: 'content', elements: [], transition: { kind: 'none' } },
        { layout: 'content', elements: [], transition: { kind: 'zoom' } }
      ])
    );
    expect(files['ppt/slides/slide1.xml']).toContain('<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" show="0">');
    expect(files['ppt/slides/slide2.xml']).toContain('<p:transition><p:fade/></p:transition>');
    expect(files['ppt/slides/slide3.xml']).toContain('<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow" p14:dur="1200"><p:wipe dir="u"/></p:transition></mc:Choice>');
    expect(files['ppt/slides/slide4.xml']).not.toContain('<p:transition');
    expect(files['ppt/slides/slide5.xml']).toContain('<p:zoom dir="in"/>');
  });

  it('a chart is a part with its values and the workbook behind it', async () => {
    const files = unzipSync(
      await writePptx(deck([{ layout: 'content', elements: [{ type: 'chart', x: 0, y: 0, w: 400, h: 300, chart: 'pie', categories: ['a', 'b'], series: [{ name: 'S', values: [3, 4] }] }] }]), noAssets)
    );
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['ppt/charts/chart1.xml', 'ppt/charts/_rels/chart1.xml.rels', 'ppt/embeddings/Microsoft_Excel_Sheet1.xlsx']));
    expect(strFromU8(files['ppt/charts/chart1.xml']!)).toContain('<c:pieChart>');
    expect(Object.keys(unzipSync(files['ppt/embeddings/Microsoft_Excel_Sheet1.xlsx']!))).toContain('xl/worksheets/sheet1.xml');
    expect(strFromU8(unzipSync(files['ppt/embeddings/Microsoft_Excel_Sheet1.xlsx']!)['xl/worksheets/sheet1.xml']!)).toContain('<v>4</v>');
  });
});

describe('the master', () => {
  it('puts its title where the layouts put a title, not a centred one, and its body where they put content', async () => {
    const cover: LayoutJSON = { id: 'cover', name: 'Cover', elements: [{ ...placeholder('ctrTitle', undefined, 400), x: 300, w: 1320, h: 300 } as ElementJSON, { ...placeholder('subTitle', 1, 750), x: 300, w: 1320 } as ElementJSON] };
    const files = await parts(deck([], { layouts: [cover, LAYOUT] }));
    const master = parsePart(files['ppt/slideMasters/slideMaster1.xml']!);
    const at = (type: string) => {
      const sp = descendants(master, 'p:sp').find((s) => child(child(child(s, 'p:nvSpPr'), 'p:nvPr'), 'p:ph')?.attrs.type === type)!;
      const off = child(child(child(sp, 'p:spPr'), 'a:xfrm'), 'a:off')!;
      return [Number(off.attrs.x) / 6350, Number(off.attrs.y) / 6350];
    };
    // LAYOUT's title is at x 100, y 50 and its body at y 200; the cover's centred title and subtitle are further down.
    expect(at('title')).toEqual([100, 50]);
    expect(at('body')).toEqual([100, 200]);
  });
});

describe('a trip changes nothing it should not', () => {
  const trip = async (d: DeckJSON): Promise<DeckJSON> => readPptx(await writePptx(d, noAssets)).deck;

  it('the master\'s text styles for other text are the presentation\'s default, and are what they were', async () => {
    const empty = await trip(deck([]));
    expect(empty.master.styles.other).toEqual({ fontSize: 18 });
    const bare = await trip(deck([], { master: { elements: [], styles: { title: {}, body: [], other: {} } } }));
    expect(bare.master.styles.other).toEqual({});
    const styled = await trip(deck([], { master: { elements: [], styles: { title: {}, body: [], other: { fontSize: 22, color: { theme: 'dk2' }, fontFamily: 'Verdana', align: 'center' } } } }));
    expect(styled.master.styles.other).toEqual({ fontSize: 22, color: { theme: 'dk2' }, fontFamily: 'Verdana', align: 'center' });
  });

  it('a layout\'s placeholder prompt is plain text: the layout\'s style is the layout\'s, not the prompt\'s', async () => {
    const styled: LayoutJSON = { ...LAYOUT, styles: { title: [{ fontSize: 60, color: { theme: 'accent2' }, fontFamily: 'Georgia', align: 'center' }], body: [{ fontSize: 30, bullet: { kind: 'none' } }] } };
    const back = await trip(deck([], { layouts: [styled] }));
    expect(back.layouts[0]!.styles).toEqual({ title: [{ fontSize: 60, color: { theme: 'accent2' }, fontFamily: 'Georgia', align: 'center' }], body: [{ fontSize: 30, bullet: { kind: 'none' } }], sldNum: undefined });
    for (const e of back.layouts[0]!.elements as { text?: TextDoc }[]) {
      expect(JSON.stringify(e.text), 'no mark').not.toContain('"marks"');
      expect(JSON.stringify(e.text), 'no paragraph attributes').not.toContain('"attrs"');
    }
  });

  it('names, alt text and titles come back as they went, not escaped twice', async () => {
    const odd = 'R&D <"all"> & \'more\'';
    const d = deck([{ layout: 'content', elements: [rect({ name: odd, alt: odd })] }], { layouts: [{ ...LAYOUT, name: odd }], theme: { ...THEME, name: odd } });
    const bytes = await writePptx(d, noAssets, { title: odd });
    const back = readPptx(bytes);
    expect(back.deck.layouts[0]!.name).toBe(odd);
    expect(back.deck.theme.name).toBe(odd);
    expect(back.deck.slides[0]!.elements[0]).toMatchObject({ name: odd, alt: odd });
    expect(back.title).toBe(odd);
  });

  it('a cut is no transition, and has no time', async () => {
    const r = readPptx(makePptx({ slides: [sp({})], slideAfter: { 1: '<p:transition spd="fast"><p:cut/></p:transition>' } }));
    expect(r.deck.slides[0]!.transition).toEqual({ kind: 'none' });
  });
});

describe('pictures', () => {
  const picture = (asset: AssetRef): ElementJSON => ({ type: 'image', x: 0, y: 0, w: 100, h: 100, asset });
  const one = (els: ElementJSON[]) => deck([{ layout: 'content', elements: els }]);

  it('come through getAsset, once for the same bytes, and are the bytes', async () => {
    const calls: string[] = [];
    const out = unzipSync(
      await writePptx(one([picture({ id: 'a' }), picture({ id: 'b' }), picture({ id: 'a' })]), async (ref) => {
        calls.push(ref.id!);
        return { bytes: PNG_1PX, mime: 'image/png' };
      })
    );
    expect(Object.keys(out).filter((n) => n.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png']);
    expect(Array.from(out['ppt/media/image1.png']!)).toEqual(Array.from(PNG_1PX));
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('are taken from the ref itself when getAsset has none, and are left out, with a count, when nothing has', async () => {
    const data = btoa(String.fromCharCode(...PNG_1PX));
    const r = await writePptxReport(one([picture({ data, mime: 'image/png' }), picture({ id: 'gone' })]), noAssets);
    expect(Object.keys(unzipSync(r.bytes)).filter((n) => n.startsWith('ppt/media/'))).toHaveLength(1);
    expect(r.warnings.map((w) => w.message)).toEqual(['1 picture could not be fetched and was left out.']);
  });

  it('are left out when they are not a picture, whatever getAsset says they are', async () => {
    const r = await writePptxReport(one([picture({ id: 'x' })]), async () => ({ bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: 'image/png' }));
    expect(Object.keys(unzipSync(r.bytes)).some((n) => n.startsWith('ppt/media/'))).toBe(false);
    expect(r.warnings.map((w) => w.message)).toEqual(['1 picture in a format a .pptx file cannot hold was left out.']);
  });

  it('a getAsset that throws costs that picture, not the file', async () => {
    const r = await writePptxReport(one([picture({ id: 'x' }), rect()]), async () => {
      throw new Error('network');
    });
    expect(readPptx(r.bytes).deck.slides[0]!.elements.map((e) => e.type)).toEqual(['shape']);
  });

  it('crop, and a picture that fills a shape', async () => {
    const png = { bytes: PNG_1PX, mime: 'image/png' };
    const crop = (await parts(one([{ ...picture({ id: 'a' }), crop: { l: 0.25, t: 0, r: 0.25, b: 0.1 } } as ElementJSON]), async () => png))['ppt/slides/slide1.xml']!;
    expect(crop).toContain('<a:srcRect l="25000" r="25000" b="10000"/>');
    const fill = (await parts(one([rect({ fill: { kind: 'image', asset: { id: 'a' }, fit: 'cover' } })]), async () => png))['ppt/slides/slide1.xml']!;
    expect(fill).toContain('<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId2"/>');
  });
});

describe('a deck from a peer is not trusted', () => {
  it('numbers that are not numbers, strings where there should be arrays, and keys named for Object', async () => {
    const hostile = {
      v: 1,
      size: 'constructor',
      theme: { id: 'x', name: '<script>', colors: { dk1: 'javascript:1', accent1: 5 }, fonts: { major: '"><x/>', minor: 1 } },
      master: { elements: 'nope', styles: { title: { fontSize: 'big', color: { theme: '__proto__' } }, body: 'nope', other: null } },
      layouts: [{ id: 'l', name: 7, elements: [{ type: 'shape', shape: '__proto__', x: NaN, y: Infinity, w: '5', h: null, ph: { type: 'constructor', idx: 'x' }, text: 'not a doc' }, { type: 'wat' }, null, 3], styles: { title: 'x' } }],
      slides: [
        {
          layout: 'toString',
          elements: [
            { type: 'shape', shape: 'rect"/><a:x', x: 1, y: 2, w: 3, h: 4, fill: { kind: 'solid', color: 'red' }, line: { color: {}, width: 'wide', dash: 'constructor', head: '__proto__' }, text: { type: 'doc', content: [{ type: 'paragraph', attrs: { align: 'constructor', level: 'x', bullet: { kind: 'char', char: '<' } }, content: [{ type: 'text', text: 7 }, { type: 'text', text: 'ok', marks: [{ type: 'textStyle', attrs: { color: 'x', fontSize: 'y', fontFamily: 7 } }, { type: 'link', attrs: { href: 5 } }, null] }] }] } },
            { type: 'table', x: 0, y: 0, w: 1, h: 1, cols: 'x', rows: [null, { h: 'x', cells: 'y' }] },
            { type: 'chart', x: 0, y: 0, w: 1, h: 1, chart: 'pie', categories: 5, series: [{ name: 3, values: 'x' }] },
            { type: 'group', x: 0, y: 0, w: 1, h: 1, children: 'no' },
            { type: 'image', x: 0, y: 0, w: 1, h: 1, asset: null }
          ],
          notes: { type: 'doc', content: 5 },
          transition: { kind: 'constructor', from: '__proto__', duration: 'x' }
        },
        null
      ]
    } as unknown as DeckJSON;
    const bytes = await writePptx(hostile, async () => null);
    const files = unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) if (/\.(?:xml|rels)$/.test(name)) expect(() => parsePart(data), name).not.toThrow();
    const text = Object.values(files).map((v) => strFromU8(v)).join('');
    expect(text).not.toMatch(/native code|\[object|<script|javascript:/);
    expect(() => readPptx(bytes)).not.toThrow();
  });

  it('a theme with no colours or fonts, and a master with no styles, are still a theme and a master', async () => {
    const bare = { v: 1, size: '16:9', theme: { id: 't', name: 'T' }, master: {}, layouts: [LAYOUT], slides: [{ layout: 'content', elements: [placeholder('title', undefined)] }] } as unknown as DeckJSON;
    const back = readPptx(await writePptx(bare, noAssets));
    expect(back.deck.slides).toHaveLength(1);
    expect(back.deck.theme.colors.accent1).toBe('#4472c4');
    expect(back.deck.theme.fonts).toEqual({ major: 'Calibri Light', minor: 'Calibri' });
  });

  it('a slide count is whatever the array has, and a layout it names that is not there is the blank one', async () => {
    const d = deck([{ layout: 'nope', elements: [] }, { layout: 'content', elements: [] }], { layouts: [LAYOUT, { id: 'blank', name: 'Blank', elements: [] }] });
    const r = readPptx(await writePptx(d, noAssets)).deck;
    expect(r.slides.length).toBe(2);
    const names = new Map(r.layouts.map((l) => [l.id, l.name]));
    expect(r.slides.map((s) => names.get(s.layout))).toEqual(['Blank', 'Title and content']);
  });
});
