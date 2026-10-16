/**
 * The pptx fidelity corpus. The bar for "does Slides open and save a PowerPoint deck properly" is a
 * set of files:
 *
 *   *.pptx          made by `generate/make_pptx.mjs`: hand-written OOXML in the three dialects
 *                   (PowerPoint, Google Slides, LibreOffice), one family of features each, with
 *                   `<name>.expect.json` saying what is true of the file independently of the reader.
 *   hostile/        files that must be refused or neutralised (`hostile.test.ts`).
 *
 * Every deck is read, written back out, read again, and the two decks compared. `python.test.ts`
 * has python-pptx, a reader that is not ours, open every export.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AssetRef, ChartElement, ElementJSON, GroupElement, ImageElement, ShapeElement, TableElement } from '../../../web/src/slides/model/deck';
import { readPptx } from '../../../web/src/formats/pptx/read';
import { writePptx } from '../../../web/src/formats/pptx/write';
import { DIR, allElements, bytesOf, expectOf, listDecks, near, outline, plain, sldIdCount, textOf, type ExpectedElement } from './helpers';

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const getAsset = async (ref: AssetRef) => (ref.data ? { bytes: decode(ref.data), mime: ref.mime ?? 'image/png' } : null);

const DECKS = listDecks();
const read = (name: string) => readPptx(bytesOf(join(DIR, name)));
const named = (n: string) => DECKS.find((f) => f.startsWith(n))!;

const where = (name: string, s: number, i: number) => `${name}, slide ${s + 1}, element ${i + 1}`;

function matches(actual: ElementJSON, want: ExpectedElement, at: string): void {
  expect(actual.type, `${at}: kind`).toBe(want.kind);
  if (want.ph !== undefined) expect('ph' in actual ? actual.ph?.type : undefined, `${at}: placeholder`).toBe(want.ph);
  if (want.box) expect(near([actual.x, actual.y, actual.w, actual.h], want.box), `${at}: box ${JSON.stringify([actual.x, actual.y, actual.w, actual.h])} against ${JSON.stringify(want.box)}`).toBe(true);
  if (want.text !== undefined) expect(textOf(actual), `${at}: text`).toBe(want.text);
  if (want.children && actual.type === 'group') expect(actual.children.length, `${at}: children`).toBe(want.children.length);
  if (want.rows !== undefined && actual.type === 'table') {
    expect(actual.rows.length, `${at}: rows`).toBe(want.rows);
    expect(actual.cols.length, `${at}: columns`).toBe(want.cols);
  }
}

describe('the corpus is what it says it is', () => {
  it('has at least 25 generated decks, each with its expectations, in all three dialects', () => {
    expect(DECKS.length).toBeGreaterThanOrEqual(25);
    const dialects = new Set(DECKS.map((d) => expectOf(d).dialect));
    expect([...dialects].sort()).toEqual(['google', 'libreoffice', 'powerpoint', 'python-pptx']);
  });

  it('covers the sizes: 16:9, 16:10 and 4:3', () => {
    const sizes = new Set(DECKS.map((d) => expectOf(d).size));
    expect([...sizes].sort()).toEqual(['16:10', '16:9', '4:3']);
  });
});

describe('every deck is read, with no lost slides', () => {
  for (const name of DECKS) {
    const want = expectOf(name);

    it(`${name}: as many slides as the file lists, as the generator wrote`, () => {
      const bytes = bytesOf(join(DIR, name));
      const { deck } = readPptx(bytes);
      expect(sldIdCount(bytes)).toBe(want.slides);
      expect(deck.slides.length).toBe(sldIdCount(bytes));
      expect(deck.size).toBe(want.size);
    });

    it(`${name}: the layouts, the hidden slides, the notes and the transitions`, () => {
      const { deck } = read(name);
      const names = new Map(deck.layouts.map((l) => [l.id, l.name]));
      expect(deck.layouts.map((l) => l.name)).toEqual(want.layouts);
      expect(deck.slides.map((s) => names.get(s.layout))).toEqual(want.slideLayouts);
      expect(deck.slides.map((s) => s.hidden === true)).toEqual(want.hidden);
      expect(deck.slides.map((s) => (s.notes ? plain(s.notes) : null))).toEqual(want.notes);
      expect(deck.slides.map((s) => (s.transition && s.transition.kind !== 'none' ? s.transition.kind : null))).toEqual(want.transitions.map((k) => (k === 'none' ? null : k)));
    });

    it(`${name}: every element, its kind, its text and its place`, () => {
      const { deck } = read(name);
      want.elements.forEach((list, s) => {
        const got = deck.slides[s]!.elements;
        expect(got.length, `${name}, slide ${s + 1}: elements`).toBe(list.length);
        list.forEach((w, i) => matches(got[i]!, w, where(name, s, i)));
      });
    });

    it(`${name}: the deck is plain data: it goes through JSON and a worker's structured clone unchanged`, () => {
      const { deck } = read(name);
      expect(JSON.parse(JSON.stringify(deck))).toEqual(deck);
      expect(structuredClone(deck)).toEqual(deck);
    });

    it(`${name}: says what it left out`, () => {
      const { warnings } = read(name);
      for (const fragment of want.warnings) expect(warnings.some((w) => w.includes(fragment)), `a warning with "${fragment}" in ${JSON.stringify(warnings)}`).toBe(true);
    });
  }
});

describe('what each family of features comes to', () => {
  it('01 text: runs keep their marks, a style gives a shape its text colour', () => {
    const { deck } = read(named('01'));
    const box = deck.slides[1]!.elements.find((e) => e.type === 'shape' && textOf(e)?.startsWith('Bold'))! as ShapeElement;
    const marks = (box.text!.content[0]!.content ?? []).map((n) => (n.marks ?? []).map((m) => m.type));
    expect(marks[0]).toContain('bold');
    expect(marks[1]).toContain('italic');
    expect(marks[2]).toContain('underline');
    expect(marks[3]).toContain('strike');
    const sized = box.text!.content[0]!.content!.at(-1)!.marks!.find((m) => m.type === 'textStyle')!;
    expect(sized.attrs).toMatchObject({ fontSize: 20, color: '#c00000' });
    expect(box.text!.content[1]!.attrs).toMatchObject({ align: 'center', bullet: { kind: 'none' } });
    const styled = deck.slides[2]!.elements.find((e) => e.type === 'shape' && e.shape === 'roundRect')! as ShapeElement;
    // fillRef accent1, lnRef accent1 shade 50%, fontRef lt1: the look of a shape made in PowerPoint.
    expect(styled.fill).toEqual({ kind: 'solid', color: { theme: 'accent1' } });
    expect(styled.line?.color).toEqual({ theme: 'accent1', lum: -0.5 });
    expect(styled.adjust).toBeCloseTo(0.3);
    const label = styled.text!.content[0]!.content![0]!.marks!.find((m) => m.type === 'textStyle')!;
    expect(label.attrs).toMatchObject({ color: { theme: 'lt1' } });
    const arrow = deck.slides[2]!.elements.find((e) => e.type === 'line')!;
    expect(arrow.type === 'line' && arrow.line).toMatchObject({ tail: 'triangle', head: 'oval', color: '#2f5597' });
  });

  it('02 layouts: placeholders take their place from the layout and the master', () => {
    const { deck } = read(named('02'));
    const title = deck.slides[0]!.elements[0]!;
    expect(title.type === 'shape' && title.ph).toEqual({ type: 'ctrTitle' });
    // The Title Slide layout's centred title, in px.
    expect(near([title.x, title.y, title.w, title.h], [240, 176.76, 1440, 376])).toBe(true);
    const two = deck.slides[2]!.elements.filter((e) => e.type === 'shape' && e.ph?.type === 'body');
    expect(two.map((e) => e.x)).toEqual([132, 972]);
    expect(two.map((e) => (e as ShapeElement).ph?.idx)).toEqual([1, 2]);
    // The slide-number field is the deck's own number, not the cached one.
    const num = deck.slides[5]!.elements.find((e) => e.type === 'shape' && e.ph?.type === 'sldNum') as ShapeElement;
    expect(plain(num.text)).toBe('‹#›');
    // Master text styles reach the deck as they are.
    expect(deck.master.styles.title.fontSize).toBe(44);
    expect(deck.master.styles.body[0]).toMatchObject({ fontSize: 28, bullet: { kind: 'char', char: '•' }, indent: 36, bulletIndent: 0 });
    expect(deck.master.styles.body[1]).toMatchObject({ fontSize: 24, indent: 108, bulletIndent: 72 });
    expect(deck.theme.fonts).toEqual({ major: 'Calibri Light', minor: 'Calibri' });
    expect(deck.theme.colors.accent1).toBe('#4472c4');
    // The layout's own styles: the title slide's 60 pt centred title.
    expect(deck.layouts[0]!.styles?.ctrTitle?.[0]).toMatchObject({ fontSize: 60, align: 'center' });
    expect(deck.layouts[0]!.styles?.subTitle?.[0]).toMatchObject({ fontSize: 24, bullet: { kind: 'none' } });
  });

  it('03 colours: a theme colour stays a theme colour, with its tint; a hex one has its tint applied', () => {
    const { deck } = read(named('03'));
    const shapes = deck.slides[0]!.elements.filter((e): e is ShapeElement => e.type === 'shape' && !e.ph);
    const fills = shapes.map((e) => e.fill);
    expect(fills[0]).toEqual({ kind: 'solid', color: { theme: 'accent1' } });
    expect(fills[1]).toEqual({ kind: 'solid', color: { theme: 'accent1', lum: 0.4 } });
    expect(fills[2]).toEqual({ kind: 'solid', color: { theme: 'accent2', lum: -0.25 } });
    expect(fills[3]).toEqual({ kind: 'solid', color: { theme: 'accent3', alpha: 0.5 } });
    expect(fills[4]).toEqual({ kind: 'solid', color: '#112233', alpha: 0.4 });
    // 4472C4 at half the luminance, worked in HSL.
    expect(fills[5]).toEqual({ kind: 'solid', color: '#203864' });
    // bg1 on a master that maps it to dk1.
    expect(fills[6]).toEqual({ kind: 'solid', color: { theme: 'dk1' } });
    const inks = shapes.map((e) => e.text!.content[0]!.content?.[0]?.marks?.find((m) => m.type === 'textStyle')?.attrs);
    // tx1 on that map is lt1; a preset colour is its hex.
    expect(inks[6]).toMatchObject({ color: { theme: 'lt1' } });
    expect(inks[7]).toMatchObject({ color: '#ffffff' });
    expect(fills[8]).toEqual({ kind: 'solid', color: { theme: 'accent4', lum: 0.6 } });
  });

  it('04 to 09 sizes: type and spacing scale with the slide, geometry to 1920 wide', () => {
    // Google's 10 in wide slide: 18 pt there is 24 pt in the deck, whose slide is 13.33 in.
    const g = read(named('04')).deck;
    const body = g.slides[1]!.elements.find((e) => e.type === 'shape' && e.ph?.type === 'body') as ShapeElement;
    const sizes = body.text!.content.map((p) => p.content![0]!.marks!.find((m) => m.type === 'textStyle')!.attrs!.fontSize);
    expect(sizes).toEqual([24, 24, 21.5]);
    expect(near([body.x, body.y, body.w, body.h], [65.45, 329.07, 1788.9, 629.89])).toBe(true);
    // A 4:3 deck is 1440 high, a 16:10 one 1200.
    expect(read(named('07')).deck.size).toBe('4:3');
    expect(read(named('08')).deck.size).toBe('16:10');
    const four = read(named('09')).deck;
    const title = four.slides[1]!.elements[0] as ShapeElement;
    expect(title.text!.content[0]!.content![0]!.marks!.find((m) => m.type === 'textStyle')!.attrs!.fontSize).toBe(58.5);
    // The master title of a 10 in deck, 44 pt there.
    expect(four.master.styles.title.fontSize).toBe(58.5);
  });

  it('05 Google tables keep their cells and fills; its explicit paragraph properties are kept', () => {
    const { deck } = read(named('05'));
    const table = deck.slides[1]!.elements.find((e) => e.type === 'table') as TableElement;
    expect(table.rows.length).toBe(3);
    expect(table.cols.length).toBe(3);
    expect(table.rows[0]!.cells[0]!.fill).toEqual({ kind: 'solid', color: '#f3f3f3' });
    expect(table.border?.color).toBe('#cccccc');
    expect(plain(table.rows[2]!.cells[1]!.text)).toBe('90');
    const first = deck.slides[0]!.elements.find((e) => e.type === 'shape' && e.ph?.idx === 1) as ShapeElement;
    expect(first.text!.content[0]!.attrs).toMatchObject({ bullet: { kind: 'char', char: '●' } });
  });

  it('10 groups: children come out in slide coordinates', () => {
    const { deck } = read(named('10'));
    const want = (expectOf(named('10')) as unknown as { groupChildren: { slide: number; element: number; children: number[][] }[] }).groupChildren;
    for (const g of want) {
      const group = deck.slides[g.slide]!.elements.filter((e) => e.type === 'group')[g.element] as GroupElement;
      const px = (emu: number[]) => emu.map((v) => v / 6350);
      group.children.forEach((c, i) => expect(near([c.x, c.y, c.w, c.h], px(g.children[i]!)), `child ${i}: ${JSON.stringify([c.x, c.y, c.w, c.h])}`).toBe(true));
    }
    const [nested, flipped] = deck.slides[0]!.elements.filter((e) => e.type === 'group').slice(1) as GroupElement[];
    // The outer group doubles its children; the inner group sits at its origin.
    const inner = nested!.children[0] as GroupElement;
    expect(inner.type).toBe('group');
    expect(near([inner.x, inner.y, inner.w, inner.h], [864, 288, 288, 288])).toBe(true);
    const deep = inner.children[0]!;
    expect(near([deep.x, deep.y, deep.w, deep.h], [864, 288, 144, 144])).toBe(true);
    // A group flipped across: its child lands on the far side, and says it is flipped.
    const c = flipped!.children[0]!;
    expect(c.flipH).toBe(true);
    expect(near([c.x, c.y, c.w, c.h], [10 * 144, 4 * 144, 144, 144])).toBe(true);
  });

  it('11 tables: merges keep the top-left cell and mark the cells they cover', () => {
    const { deck } = read(named('11'));
    const t = deck.slides[0]!.elements.find((e) => e.type === 'table') as TableElement;
    expect(t.rows[0]!.cells[0]).toMatchObject({ colSpan: 2 });
    expect(t.rows[0]!.cells[1]).toMatchObject({ merged: true });
    expect(t.rows[1]!.cells[0]).toMatchObject({ rowSpan: 2, anchor: 'middle' });
    expect(t.rows[2]!.cells[0]).toMatchObject({ merged: true });
    expect(t.rows[2]!.cells[2]).toMatchObject({ colSpan: 2, rowSpan: 2, fill: { kind: 'solid', color: '#ffe699' } });
    expect(t.rows[3]!.cells[3]).toMatchObject({ merged: true });
    expect(t.firstRow).toBe(true);
    expect(t.bandRows).toBe(true);
    // The grid is the table's size, whatever the frame said.
    expect(near([t.w, t.h], [6 * 144, (4 * 370840) / 6350])).toBe(true);
    const plainTable = deck.slides[1]!.elements.find((e) => e.type === 'table') as TableElement;
    expect(plainTable.firstRow).toBeUndefined();
  });

  it('12 33 charts: the values the file cached, as the generator wrote them and as python-pptx wrote them', () => {
    for (const name of [named('12'), named('33')]) {
      const want = expectOf(name).charts;
      const got = read(name).deck.slides.flatMap((s) => s.elements.filter((e): e is ChartElement => e.type === 'chart'));
      expect(got.length, name).toBe(want.length);
      want.forEach((w, i) => {
        expect(got[i]!.chart, `${name} chart ${i}`).toBe(w.chart);
        if (w.chart !== 'scatter') expect(got[i]!.categories, `${name} chart ${i}`).toEqual(w.categories);
        expect(got[i]!.series.map((s) => ({ name: s.name, values: s.values.map((v) => Math.round(v * 1e9) / 1e9) })), `${name} chart ${i}`).toEqual(w.series.map((s) => ({ name: s.name, values: s.values.map((v) => Math.round(v * 1e9) / 1e9) })));
        expect(got[i]!.title ?? null, `${name} chart ${i}`).toBe(w.title);
      });
    }
    expect(read(named('12')).deck.slides[0]!.elements.find((e): e is ChartElement => e.type === 'chart')!.series[0]!.color).toBe('#4472c4');
  });

  it("31 PowerPoint's own template: eleven layouts, the Office theme, 4:3, tints and links from real XML", () => {
    const { deck, warnings } = read(named('31'));
    expect(deck.size).toBe('4:3');
    expect(deck.layouts).toHaveLength(11);
    expect(deck.theme.name).toBe('Office Theme');
    expect(deck.theme.colors.accent1).toBe('#4f81bd');
    // The master's own text styles, on a 10 in slide: 44 pt is 58.5 on ours.
    expect(deck.master.styles.title.fontSize).toBe(58.5);
    // 32, 28, 24 and 20 pt on that slide, then 20 for the rest.
    expect(deck.master.styles.body.map((l) => l.fontSize)).toEqual([42.5, 37.5, 32, 26.5, 26.5, 26.5, 26.5, 26.5, 26.5]);
    const tinted = deck.slides[3]!.elements.find((e) => e.type === 'shape' && textOf(e) === 'Accent 2, lighter 40%') as ShapeElement;
    expect(tinted.fill).toEqual({ kind: 'solid', color: { theme: 'accent2', lum: 0.4 } });
    const oval = deck.slides[3]!.elements.find((e) => e.type === 'shape' && e.shape === 'ellipse') as ShapeElement;
    expect(oval.fill).toEqual({ kind: 'solid', color: '#70ad47' });
    expect(oval.line).toMatchObject({ color: { theme: 'accent1' }, width: 8 });
    const linked = (deck.slides[1]!.elements[1] as ShapeElement).text!.content.at(-1)!.content![0]!;
    expect(linked.marks!.map((m) => m.type)).toEqual(['bold', 'textStyle', 'link']);
    expect(linked.marks!.at(-1)!.attrs).toEqual({ href: 'https://example.com/office' });
    const levels = (deck.slides[1]!.elements[1] as ShapeElement).text!.content.map((p) => p.attrs?.level ?? 0);
    expect(levels).toEqual([0, 1, 2, 0, 0]);
    expect(plain(deck.slides[4]!.notes)).toBe("Notes that PowerPoint's template gives a home.");
    expect(warnings).toEqual([]);
  });

  it('13 notes and 14 hidden slides', () => {
    const { deck } = read(named('13'));
    expect(plain(deck.slides[0]!.notes)).toBe('Open with the numbers.\nPause for questions.');
    expect(deck.slides[1]!.notes).toBeUndefined();
    expect(deck.slides[2]!.notes!.content[0]!.content!.map((n) => n.marks?.map((m) => m.type) ?? [])).toEqual([['bold'], []]);
    expect(read(named('14')).deck.slides.map((s) => s.hidden === true)).toEqual([false, true, false, true]);
  });

  it('15 transitions: the nearest of the five, with their side and time', () => {
    const { deck } = read(named('15'));
    const t = deck.slides.map((s) => s.transition);
    expect(t[0]).toEqual({ kind: 'fade', duration: 750 });
    expect(t[1]).toEqual({ kind: 'push', duration: 500, from: 'bottom' });
    expect(t[2]).toEqual({ kind: 'wipe', duration: 1000, from: 'left' });
    expect(t[3]).toEqual({ kind: 'zoom' });
    expect(t[4]).toEqual({ kind: 'fade', duration: 2000 });
    expect(t[5]).toEqual({ kind: 'push', duration: 900, from: 'right' });
    expect(t[6]?.kind).toBe('none');
    expect(t[10]).toBeUndefined();
  });

  it('16 pictures: four formats, a crop, and the ones that cannot be shown are left out', () => {
    const { deck, warnings } = read(named('16'));
    const imgs = (n: number) => deck.slides[n]!.elements.filter((e): e is ImageElement => e.type === 'image');
    expect(imgs(0).map((i) => i.asset.mime)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(imgs(0)[0]!.alt).toBe('Blue');
    expect(imgs(1)[0]!.crop).toEqual({ l: 0.25, t: 0.1, r: 0.25, b: 0 });
    expect(imgs(1)[1]!.crop).toEqual({ l: 0, t: 0.5, r: 0, b: 0 });
    // The SVG's PNG fallback is the picture; the EMF and the linked picture are not.
    expect(imgs(2).length).toBe(1);
    expect(imgs(2)[0]!.asset.mime).toBe('image/png');
    expect(warnings.join(' ')).toMatch(/EMF, WMF, SVG or TIFF/);
    expect(warnings.join(' ')).toMatch(/linked from outside/);
  });

  it('17 links: web and mail addresses are kept, scripts and files are not', () => {
    const { deck, warnings } = read(named('17'));
    const hrefs: string[] = [];
    const walk = (n: { marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }): void => {
      for (const m of n.marks ?? []) if (m.type === 'link') hrefs.push(String(m.attrs!.href));
      for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
    };
    for (const e of allElements(deck)) if (e.type === 'shape' && e.text) walk(e.text as never);
    expect(hrefs).toEqual(['https://example.com/office', 'mailto:hello@example.com']);
    expect(warnings.join(' ')).toMatch(/2 links to places other than web and mail addresses were left out/);
    expect(warnings.join(' ')).toMatch(/1 link to other slides/);
  });

  it('18 bullets: nine levels, the six number styles, a character, a symbol font', () => {
    const { deck } = read(named('18'));
    const levels = (deck.slides[0]!.elements[1] as ShapeElement).text!.content.map((p) => p.attrs?.level ?? 0);
    expect(levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const bullets = (deck.slides[1]!.elements[1] as ShapeElement).text!.content.map((p) => p.attrs?.bullet);
    expect(bullets).toEqual([
      { kind: 'number', style: 'arabicPeriod' },
      { kind: 'number', style: 'arabicParen' },
      { kind: 'number', style: 'alphaLcPeriod', start: 3 },
      { kind: 'number', style: 'alphaUcPeriod' },
      { kind: 'number', style: 'romanLcPeriod' },
      { kind: 'number', style: 'romanUcPeriod' },
      { kind: 'char', char: '★' },
      { kind: 'char', char: '▪' },
      { kind: 'none' }
    ]);
  });

  it('19 20 geometry: a freeform is a rectangle with a warning; presets are kept; lines have ends', () => {
    const free = read(named('19'));
    const shapes = free.deck.slides[0]!.elements.filter((e): e is ShapeElement => e.type === 'shape' && !e.ph);
    expect(shapes.map((s) => s.shape)).toEqual(['rect', 'diamond', 'rect', 'plus']);
    expect(free.warnings.join(' ')).toMatch(/1 freeform shape is drawn as a rectangle/);
    expect(free.warnings.join(' ')).toMatch(/1 shape in a form that cannot be drawn is drawn as a rectangle/);
    const { deck, warnings } = read(named('20'));
    expect(deck.slides[0]!.elements.filter((e) => e.type === 'shape' && !e.ph).map((e) => (e as ShapeElement).shape)).toEqual(['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'rightArrow', 'chevron', 'cloud', 'heart', 'can']);
    const lines = deck.slides[1]!.elements.filter((e) => e.type === 'line');
    expect(lines.length).toBe(4);
    const diag = lines[2] as Extract<ElementJSON, { type: 'line' }>;
    expect(diag).toMatchObject({ flipH: true, line: { color: '#0070c0', head: 'triangle', dash: 'dot' } });
    expect(near([diag.x, diag.y, diag.w, diag.h], [6 * 144, 3 * 144, 3 * 144, 2 * 144])).toBe(true);
    const rot = deck.slides[1]!.elements.find((e) => e.type === 'shape' && e.rot) as ShapeElement;
    expect(rot.rot).toBe(15);
    expect(rot.shadow).toBe(true);
    expect(warnings.join(' ')).toMatch(/1 elbow or curved connector is drawn as a straight line/);
    const dashed = deck.slides[0]!.elements.find((e) => e.type === 'shape' && !e.ph) as ShapeElement;
    expect(dashed.line).toMatchObject({ dash: 'dash', color: '#404040' });
  });

  it("21 backgrounds: solid, gradient, picture and the theme's", () => {
    const { deck } = read(named('21'));
    expect(deck.master.bg).toEqual({ kind: 'solid', color: '#f2f2f2' });
    expect(deck.slides[0]!.bg).toBeUndefined();
    expect(deck.slides[1]!.bg).toEqual({ kind: 'solid', color: { theme: 'accent1', lum: 0.8 } });
    expect(deck.slides[2]!.bg).toMatchObject({ kind: 'gradient', angle: 90, stops: [{ at: 0, color: '#1f3864' }, { at: 1, color: '#8faadc' }] });
    expect(deck.slides[3]!.bg).toMatchObject({ kind: 'image', fit: 'stretch', asset: { mime: 'image/png' } });
    expect(deck.slides[4]!.bg).toEqual({ kind: 'solid', color: { theme: 'accent2' } });
  });

  it('23 objects: SmartArt is its saved drawing; an OLE object is its picture', () => {
    const { deck, warnings } = read(named('23'));
    const smart = deck.slides[0]!.elements.find((e) => e.type === 'group') as GroupElement;
    expect(smart.children.map((c) => textOf(c))).toEqual(['Plan', 'Build', 'Ship']);
    // Positions are relative to the frame, which is at 1 in, 2 in.
    expect(near([smart.children[0]!.x, smart.children[0]!.y], [144, 288 + 500000 / 6350])).toBe(true);
    expect((smart.children[0] as ShapeElement).fill).toEqual({ kind: 'solid', color: { theme: 'accent1' } });
    expect(deck.slides[1]!.elements.some((e) => e.type === 'image')).toBe(true);
    expect(deck.slides[2]!.elements.some((e) => e.type === 'image')).toBe(false);
    expect(warnings.join(' ')).toMatch(/EMF, WMF, SVG or TIFF/);
  });

  it("24 two masters: the first slide's master is the deck's, the other's layout is folded in with its colours baked", () => {
    const { deck } = read(named('24'));
    expect(deck.layouts.map((l) => l.name)).toEqual(['Title Slide', 'Title and Content', 'Section Header', 'Two Content', 'Title Only', 'Blank', 'Divider']);
    const divider = deck.layouts[6]!;
    expect(divider.showMaster).toBe(false);
    expect(divider.bg).toEqual({ kind: 'solid', color: '#203864' });
    // The second master's band, in its own accent1 (C00000), not the deck's.
    const band = divider.elements.find((e) => e.type === 'shape' && e.name === 'Band') as ShapeElement;
    expect(band.fill).toEqual({ kind: 'solid', color: '#c00000' });
    // Its title is set in its own theme's major font, which the deck's theme does not have.
    expect(divider.styles?.title?.[0]?.fontFamily).toBe('Georgia');
    expect(deck.theme.fonts.major).toBe('Calibri Light');
  });

  it('25 text: super and subscript, theme fonts, highlight, breaks, fields, vertical text, autofit', () => {
    const { deck } = read(named('25'));
    const [runs, vertical, anchored, field] = deck.slides[0]!.elements.filter((e): e is ShapeElement => e.type === 'shape' && !e.ph);
    const p0 = runs!.text!.content[0]!.content!;
    expect(p0.map((n) => n.marks?.map((m) => m.type) ?? [])).toEqual([[], ['sup'], [], ['sub'], []]);
    const fonts = runs!.text!.content[1]!.content!.map((n) => n.marks?.find((m) => m.type === 'textStyle')?.attrs?.fontFamily);
    expect(fonts).toEqual(['Calibri Light', 'Calibri', 'Georgia']);
    const p2 = runs!.text!.content[2]!.content!;
    expect(p2[0]!.marks!.find((m) => m.type === 'highlight')!.attrs).toEqual({ color: '#ffff00' });
    expect(p2.some((n) => n.type === 'hardBreak')).toBe(true);
    expect(vertical!.textBox).toMatchObject({ vertical: true, autofit: 'grow' });
    expect(anchored!.textBox).toMatchObject({ anchor: 'bottom', autofit: 'shrink', wrap: false, insets: { l: 0, t: 0, r: 0, b: 0 } });
    expect(plain(field!.text)).toBe('Page ‹#›');
    const spacing = deck.slides[1]!.elements.find((e) => e.type === 'shape' && !e.ph) as ShapeElement;
    expect(spacing.text!.content[0]!.attrs).toMatchObject({ lineHeight: 0.9 });
    expect(spacing.text!.content[1]!.attrs).toMatchObject({ spaceBefore: 12 });
    expect(spacing.text!.content[2]!.attrs).toMatchObject({ spaceAfter: 6 });
    expect(spacing.text!.content[3]!.attrs).toMatchObject({ indent: 72, bulletIndent: 36, bullet: { kind: 'char', char: '•' } });
  });

  it("26 inheritance: a placeholder with no place of its own has its layout's, then the master's", () => {
    const { deck } = read(named('26'));
    const [a, b] = deck.slides.map((s) => s.elements[0] as ShapeElement);
    expect(near([a!.x, a!.y, a!.w, a!.h], [132, 57.5, 1656, 208.75])).toBe(true);
    expect(a!.textBox).toMatchObject({ anchor: 'middle', autofit: 'shrink' });
    expect(near([b!.x, b!.y, b!.w, b!.h], [1000000 / 6350, 500000 / 6350, 6000000 / 6350, 900000 / 6350])).toBe(true);
    expect(b!.textBox).toMatchObject({ anchor: 'middle' });
  });

  it('27 Unicode survives', () => {
    const { deck } = read(named('27'));
    const body = deck.slides[0]!.elements[1] as ShapeElement;
    expect(plain(body.text)).toContain('日本語のテキスト');
    expect(plain(body.text)).toContain('مرحبا بالعالم');
    expect(plain(body.text)).toContain('Emoji 😀 🚀 and a flag 🇳🇴');
  });

  it('28 strict namespaces read as the transitional ones', () => {
    const { deck } = read(named('28'));
    expect(plain((deck.slides[0]!.elements[0] as ShapeElement).text)).toBe('Strict OOXML');
    expect(deck.layouts.length).toBe(6);
  });

  it('29 edges: an empty slide, empty placeholders, a hidden shape, a shape off the slide', () => {
    const { deck } = read(named('29'));
    expect(deck.slides[0]!.elements).toEqual([]);
    expect(deck.slides[1]!.elements.map((e) => (e as ShapeElement).ph?.type)).toEqual(['title', 'body']);
    expect(deck.slides[1]!.elements.every((e) => e.type === 'shape' && e.text !== undefined)).toBe(true);
    // The hidden shape is not an element; the zero-size one is.
    expect(deck.slides[2]!.elements.length).toBe(3);
    expect(deck.slides[3]!.elements.map((e) => e.x)).toEqual([expect.any(Number), -2 * 144, 11 * 144]);
  });

  it("30 decorations: the master's shapes, hidden by a layout and by a slide", () => {
    const { deck } = read(named('30'));
    expect(deck.master.elements.length).toBe(1);
    expect(deck.layouts.map((l) => l.showMaster)).toEqual([undefined, false]);
    expect(deck.layouts[1]!.elements.some((e) => e.name === 'Layout bar')).toBe(true);
    expect(deck.slides.map((s) => s.showMaster)).toEqual([undefined, undefined, false]);
  });
});

describe('a 120-slide deck', () => {
  it('imports in under two seconds', () => {
    const bytes = bytesOf(join(DIR, named('22')));
    const t0 = performance.now();
    const { deck } = readPptx(bytes);
    const ms = performance.now() - t0;
    expect(deck.slides.length).toBe(120);
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(2000);
    process.stdout.write(`120 slides in ${ms.toFixed(0)} ms\n`);
  });
});

describe('import, export, import', () => {
  for (const name of DECKS) {
    it(`${name}: the same slides, layouts, placeholders, text, kinds and places`, async () => {
      const first = readPptx(bytesOf(join(DIR, name))).deck;
      const bytes = await writePptx(first, getAsset);
      const second = readPptx(bytes).deck;
      const a = outline(first);
      const b = outline(second);
      expect(b.slides.length).toBe(a.slides.length);
      expect(b.size).toBe(a.size);
      expect(b.layouts.map((l) => l.name)).toEqual(a.layouts.map((l) => l.name));
      expect(b.layouts.map((l) => l.placeholders)).toEqual(a.layouts.map((l) => l.placeholders));
      a.slides.forEach((s, i) => {
        const t = b.slides[i]!;
        expect(t.layout, `slide ${i + 1}: layout`).toBe(s.layout);
        expect(t.hidden, `slide ${i + 1}: hidden`).toBe(s.hidden);
        expect(t.showMaster, `slide ${i + 1}: master shapes`).toBe(s.showMaster);
        expect(t.notes, `slide ${i + 1}: notes`).toBe(s.notes);
        expect(t.transition, `slide ${i + 1}: transition`).toBe(s.transition);
        expect(t.from, `slide ${i + 1}: side`).toBe(s.from);
        expect(t.elements.length, `slide ${i + 1}: elements`).toBe(s.elements.length);
        const same = (x: (typeof s.elements)[number], y: (typeof s.elements)[number], at: string): void => {
          expect(y.kind, `${at}: kind`).toBe(x.kind);
          expect(y.ph, `${at}: placeholder`).toBe(x.ph);
          expect(y.idx, `${at}: idx`).toBe(x.idx);
          expect(y.text, `${at}: text`).toBe(x.text);
          expect(near(y.box, x.box), `${at}: ${JSON.stringify(y.box)} against ${JSON.stringify(x.box)}`).toBe(true);
          if (x.kind !== 'group') expect(y.rot ?? 0, `${at}: rotation`).toBeCloseTo(x.rot ?? 0, 1);
          expect(y.shape, `${at}: shape`).toBe(x.shape);
          expect(y.table, `${at}: table`).toEqual(x.table);
          expect(y.chart, `${at}: chart`).toEqual(x.chart);
          expect(y.image, `${at}: picture`).toEqual(x.image);
          expect(y.children?.length, `${at}: children`).toBe(x.children?.length);
          x.children?.forEach((c, k) => same(c, y.children![k]!, `${at}.${k + 1}`));
        };
        s.elements.forEach((x, k) => same(x, t.elements[k]!, `${name}, slide ${i + 1}, element ${k + 1}`));
      });
    });
  }

  it('is stable after one trip: a second trip changes nothing', async () => {
    for (const name of DECKS.filter((n) => !n.startsWith('22'))) {
      const once = readPptx(await writePptx(readPptx(bytesOf(join(DIR, name))).deck, getAsset)).deck;
      const twice = readPptx(await writePptx(once, getAsset)).deck;
      expect(JSON.stringify(twice), name).toBe(JSON.stringify(once));
    }
  });

  it('writes the pictures of an imported deck after the uploader has swapped their bytes for ids, fetching each once', async () => {
    const first = readPptx(bytesOf(join(DIR, named('22')))).deck;
    // What the page does: every picture object the reader made is stored, and becomes an id.
    const store = new Map<string, { bytes: Uint8Array; mime: string }>();
    const seen = new Set<AssetRef>();
    const visit = (e: ElementJSON): void => {
      if (e.type === 'image' && !seen.has(e.asset)) {
        seen.add(e.asset);
        const id = `asset${store.size + 1}`;
        store.set(id, { bytes: decode(e.asset.data!), mime: e.asset.mime! });
        delete e.asset.data;
        delete e.asset.mime;
        e.asset.id = id;
      }
      if (e.type === 'group') e.children.forEach(visit);
    };
    for (const s of first.slides) s.elements.forEach(visit);
    // 12 slides carry the same picture: one object, so one upload.
    expect(store.size).toBe(1);
    const fetched: string[] = [];
    const bytes = await writePptx(first, async (ref) => {
      fetched.push(ref.id!);
      return store.get(ref.id!) ?? null;
    });
    expect(fetched).toEqual(['asset1']);
    const again = readPptx(bytes).deck;
    expect(again.slides.flatMap((s) => s.elements.filter((e) => e.type === 'image')).length).toBe(12);
  });

  it('writes the same bytes for the same deck', async () => {
    const deck = read(named('01')).deck;
    const a = await writePptx(deck, getAsset);
    const b = await writePptx(deck, getAsset);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
