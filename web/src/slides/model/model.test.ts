import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ElementJSON, ShapeElement } from './deck';
import { arranged, type ModelNotice, type SlideModel } from './model';
import { plainText } from './schema';
import { box, LAYOUTS, MASTER, modelOf, testDeck, THEME, txt } from './testing';
import { orderOf, slidesOf } from './ydoc';

const texts = (m: SlideModel, id: string) => m.slide(id)!.elements.map((e) => (e.type === 'shape' ? plainText(e.text) : e.type));
const notices = (m: SlideModel): ModelNotice[] => {
  const out: ModelNotice[] = [];
  m.onNotice((n) => out.push(n));
  return out;
};
const state = (m: SlideModel) => Y.encodeStateVector(m.doc).join(',');

describe('slides', () => {
  it('a new slide copies its layout’s placeholders, without footers or prompts', () => {
    const m = modelOf();
    const id = m.addSlide('twoContent', 0)!;
    expect(m.order()).toEqual([id, 's1']);
    const els = m.slide(id)!.elements as ShapeElement[];
    expect(els.map((e) => [e.ph?.type, e.ph?.idx])).toEqual([['title', undefined], ['body', 1], ['body', 2]]);
    expect(els.every((e) => plainText(e.text) === '')).toBe(true);
    expect(els.map((e) => e.x)).toEqual([154, 154, 990]);
    expect(new Set(els.map((e) => e.id)).size).toBe(3);
  });

  it('an unknown layout makes a blank slide', () => {
    const m = modelOf();
    const id = m.addSlide('nope')!;
    expect(m.slide(id)!.layout).toBe('blank');
    expect(m.slide(id)!.elements).toEqual([]);
  });

  it('duplicates after the last of the chosen, in deck order', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [box(1, 1)] }, { id: 'b', layout: 'blank', elements: [] }, { id: 'c', layout: 'blank', elements: [] }]));
    const copies = m.duplicateSlides(['b', 'a'])!;
    expect(m.order()).toEqual(['a', 'b', ...copies, 'c']);
    expect(m.slide(copies[0]!)!.elements.map((e) => e.x)).toEqual([1]);
  });

  it('moves many at once, before the slide at the drop', () => {
    const m = modelOf(testDeck(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, layout: 'blank', elements: [] }))));
    expect(m.moveSlides(['d', 'b'], 0)).toBe(true);
    expect(m.order()).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(m.moveSlides(['b'], 5)).toBe(true);
    expect(m.order()).toEqual(['d', 'a', 'c', 'e', 'b']);
    expect(m.moveSlides(['a', 'c'], 2)).toBe(false);
    expect(orderOf(m.doc).length).toBe(5);
  });

  it('deletes, and refuses to delete the last slide', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [] }, { id: 'b', layout: 'blank', elements: [] }]));
    const n = notices(m);
    expect(m.deleteSlides(['a'])).toBe(true);
    expect(m.order()).toEqual(['b']);
    expect(m.deleteSlides(['b'])).toBe(false);
    expect(n.map((x) => x.message)).toEqual(['A presentation needs at least one slide.']);
  });

  it('a new layout keeps placeholder text, moves it, adds what is missing and drops what is empty', () => {
    const m = modelOf();
    const s = m.addSlide('twoContent')!;
    const [title, left, right] = m.slide(s)!.elements.map((e) => e.id!);
    m.setText(s, title!, txt('Plan'));
    m.setText(s, right!, txt('Right column'));
    expect(m.setLayout([s], 'titleContent')).toBe(true);
    const after = m.slide(s)!;
    expect(after.layout).toBe('titleContent');
    // Title kept; body idx 1 is the left column (empty, but it matches); the right column has text and stays.
    expect(after.elements.map((e) => e.id)).toEqual([title, left, right]);
    expect(texts(m, s)).toEqual(['Plan', '', 'Right column']);
    expect(m.element(s, left!)!.w).toBe(1612);
    // Back to a title slide: the title becomes the centred title, the content becomes the subtitle.
    m.setLayout([s], 'title');
    const t = m.slide(s)!.elements as ShapeElement[];
    expect(t.find((e) => e.id === title)!.ph).toEqual({ type: 'ctrTitle' });
    expect(t.find((e) => e.id === left)!.ph).toEqual({ type: 'subTitle' });
    expect(t.find((e) => e.id === title)!.y).toBe(270);
  });

  it('a new design moves the placeholders nobody moved and leaves the ones somebody did', () => {
    const m = modelOf();
    const s = m.addSlide('titleContent')!;
    const [title, body] = m.slide(s)!.elements.map((e) => e.id!);
    m.updateElements(s, [{ id: body!, patch: { x: 500 } }]);
    const layouts = LAYOUTS.map((l) => ({ ...l, elements: l.elements.map((e) => ({ ...e, y: e.y + 10 })) }));
    expect(m.setDesign({ theme: { ...THEME, id: 'other' }, master: MASTER, layouts })).toBe(true);
    expect(m.design().theme.id).toBe('other');
    expect(m.element(s, title!)!.y).toBe(110);
    expect(m.element(s, body!)!.y).toBe(368);
    expect(m.element(s, body!)!.x).toBe(500);
  });

  it('reset puts placeholders back where the layout has them, keeps text, and is one undo', () => {
    const m = modelOf();
    const s = m.addSlide('titleContent')!;
    const [title, body] = m.slide(s)!.elements.map((e) => e.id!);
    m.setText(s, title!, txt('Plan'));
    m.updateElements(s, [{ id: title!, patch: { x: 400, y: 600, w: 300 } }]);
    m.deleteElements(s, [body!]);
    expect(m.resetSlides([s])).toBe(true);
    const els = m.slide(s)!.elements as ShapeElement[];
    const t = els.find((e) => e.id === title)!;
    expect([t.x, t.y, t.w]).toEqual([154, 100, 1612]);
    expect(plainText(t.text)).toBe('Plan');
    expect(els.map((e) => e.ph?.type)).toEqual(['title', 'body']);
    m.undo();
    expect(m.element(s, title!)!.x).toBe(400);
    expect(m.slide(s)!.elements).toHaveLength(1);
  });

  it('sets the text of several shapes as one step, skipping what is not a shape', () => {
    const line: ElementJSON = { id: 'l', type: 'line', x: 0, y: 0, w: 10, h: 0, line: { color: '#000000', width: 1 } };
    const m = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0), id: 'a', text: txt('one') }, { ...box(0, 0), id: 'b' }, line] }]));
    expect(m.setTexts('s1', [{ id: 'a', text: txt('A') }, { id: 'b', text: txt('B') }, { id: 'l', text: txt('L') }])).toBe(true);
    expect(texts(m, 's1')).toEqual(['A', 'B', 'line']);
    m.undo();
    expect(texts(m, 's1')).toEqual(['one', '', 'line']);
    expect(m.setTexts('s1', [{ id: 'l', text: txt('L') }])).toBe(false);
  });

  it('makes a slide’s notes to type in without an undo entry, and never for a reader', () => {
    const m = modelOf();
    (slidesOf(m.doc).get('s1') as Y.Map<unknown>).delete('notes');
    expect(m.notesFragment('s1')).toBeNull();
    const frag = m.ensureNotes('s1')!;
    expect(m.ensureNotes('s1')).toBe(frag);
    expect(m.canUndo()).toBe(false);
    const reader = modelOf(undefined, { readOnly: true });
    (slidesOf(reader.doc).get('s1') as Y.Map<unknown>).delete('notes');
    expect(reader.ensureNotes('s1')).toBeNull();
  });

  it('a reader cannot reset', () => {
    const m = modelOf(undefined, { readOnly: true });
    expect(m.resetSlides(['s1'])).toBe(false);
  });

  it('sets a slide’s background, hidden and transition, and removes them with null', () => {
    const m = modelOf();
    m.setSlides(['s1'], { bg: { kind: 'solid', color: '#000000' }, hidden: true, transition: { kind: 'fade' } });
    expect(m.slide('s1')).toMatchObject({ bg: { kind: 'solid', color: '#000000' }, hidden: true, transition: { kind: 'fade' } });
    m.setSlides(['s1'], { bg: null, hidden: false, transition: null });
    const s = m.slide('s1')!;
    expect([s.bg, s.hidden, s.transition]).toEqual([undefined, undefined, undefined]);
  });
});

describe('elements', () => {
  it('adds with fresh ids and a body to type in, and pastes the same element twice as two', () => {
    const m = modelOf();
    const [a, b] = m.pasteElements('s1', [{ ...box(0, 0), id: 'x' }, { ...box(5, 5), id: 'x' }])!;
    expect(a).not.toBe('x');
    expect(a).not.toBe(b);
    expect(m.textFragment('s1', a!)).not.toBeNull();
    const c = m.addElement('s1', box(9, 9), 0)!;
    expect(m.slide('s1')!.elements.map((e) => e.id)).toEqual([c, a, b]);
  });

  it('moving a group moves and scales its children', () => {
    const m = modelOf();
    const [a, b] = m.addElements('s1', [box(0, 0, 100, 100), box(100, 100, 100, 100)])!;
    const g = m.group('s1', [a!, b!])!;
    expect(m.element('s1', g)).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
    m.updateElements('s1', [{ id: g, patch: { x: 10, y: 20, w: 400, h: 100 } }]);
    expect(m.element('s1', a!)).toMatchObject({ x: 10, y: 20, w: 200, h: 50 });
    expect(m.element('s1', b!)).toMatchObject({ x: 210, y: 70, w: 200, h: 50 });
  });

  it('groups where the frontmost member was, and ungroups in its place', () => {
    const m = modelOf();
    const [p, a, q, b, r] = m.addElements('s1', [box(0, 0), box(1, 1), box(2, 2), box(3, 3), box(4, 4)])!;
    const g = m.group('s1', [a!, b!])!;
    expect(m.slide('s1')!.elements.map((e) => e.id)).toEqual([p, q, g, r]);
    expect(m.topOf('s1', a!)).toBe(g);
    expect(m.ungroup('s1', [g])).toEqual([a, b]);
    expect(m.slide('s1')!.elements.map((e) => e.id)).toEqual([p, q, a, b, r]);
    expect(m.element('s1', g)).toBeNull();
  });

  it('ungrouping a turned group turns its children about its centre', () => {
    const m = modelOf();
    const [a, b] = m.addElements('s1', [box(0, 0, 100, 100), box(300, 0, 100, 100)])!;
    const g = m.group('s1', [a!, b!])!;
    m.updateElements('s1', [{ id: g, patch: { rot: 90 } }]);
    m.ungroup('s1', [g]);
    // The group is 400 by 100 about (200, 50); a quarter turn puts a's centre (50, 50) at (200, -100).
    const ea = m.element('s1', a!)!;
    expect([Math.round(ea.x + 50), Math.round(ea.y + 50), ea.rot]).toEqual([200, -100, 90]);
  });

  it('refuses to nest groups past 8', () => {
    const m = modelOf();
    const n = notices(m);
    let ids = m.addElements('s1', [box(0, 0), box(1, 1)])!;
    let g = m.group('s1', ids)!;
    for (let i = 1; i < 8; i++) {
      const other = m.addElement('s1', box(2, 2))!;
      g = m.group('s1', [g, other])!;
    }
    const other = m.addElement('s1', box(3, 3))!;
    expect(m.group('s1', [g, other])).toBeNull();
    expect(n.at(-1)!.message).toMatch(/nested at most 8/);
    ids = [];
  });

  it('deletes a group with its children, and a group its last child leaves', () => {
    const m = modelOf();
    const [a, b, c] = m.addElements('s1', [box(0, 0), box(1, 1), box(2, 2)])!;
    const g = m.group('s1', [a!, b!])!;
    m.deleteElements('s1', [a!, b!]);
    expect(m.element('s1', g)).toBeNull();
    expect(m.slide('s1')!.elements.map((e) => e.id)).toEqual([c]);
  });

  it('brings forward and sends back among siblings', () => {
    expect(arranged(['a', 'b', 'c', 'd'], new Set(['a', 'b']), 'forward')).toEqual(['c', 'a', 'b', 'd']);
    expect(arranged(['a', 'b', 'c', 'd'], new Set(['d']), 'backward')).toEqual(['a', 'b', 'd', 'c']);
    expect(arranged(['a', 'b', 'c', 'd'], new Set(['b', 'c']), 'front')).toEqual(['a', 'd', 'b', 'c']);
    expect(arranged(['a', 'b', 'c', 'd'], new Set(['c']), 'back')).toEqual(['c', 'a', 'b', 'd']);
    const m = modelOf();
    const [a, b, c] = m.addElements('s1', [box(0, 0), box(1, 1), box(2, 2)])!;
    expect(m.reorder('s1', [a!], 'front')).toBe(true);
    expect(m.slide('s1')!.elements.map((e) => e.id)).toEqual([b, c, a]);
    expect(m.reorder('s1', [a!], 'front')).toBe(false);
  });

  it('refuses past 400 objects on a slide, writing nothing', () => {
    const m = modelOf();
    const n = notices(m);
    m.addElements('s1', Array.from({ length: 399 }, () => box(0, 0)));
    const before = state(m);
    expect(m.addElements('s1', [box(0, 0), box(1, 1)])).toBeNull();
    expect(state(m)).toBe(before);
    expect(n.at(-1)).toEqual({ kind: 'limit', message: 'A slide holds at most 400 objects.' });
    expect(m.addElement('s1', box(0, 0))).not.toBeNull();
  });

  it('refuses past 500 slides', () => {
    const m = modelOf(testDeck(Array.from({ length: 499 }, () => ({ layout: 'blank', elements: [] }))));
    const n = notices(m);
    expect(m.addSlide('blank')).not.toBeNull();
    expect(m.addSlide('blank')).toBeNull();
    expect(m.duplicateSlides([m.order()[0]!])).toBeNull();
    expect(n.map((x) => x.message)).toEqual(['A presentation holds at most 500 slides.', 'A presentation holds at most 500 slides.']);
  });

  it('refuses a step that would take the state past 3 MiB', () => {
    const m = modelOf();
    const n = notices(m);
    const big = (k: number): ElementJSON => ({ ...box(0, 0), text: txt('x'.repeat(k)) });
    expect(m.addElement('s1', big(1_500_000))).not.toBeNull();
    const before = state(m);
    expect(m.addElement('s1', big(1_700_000))).toBeNull();
    expect(state(m)).toBe(before);
    expect(n.at(-1)!.kind).toBe('too-large');
    expect(m.nearLimit()).toBe(false);
    expect(m.addElement('s1', big(700_000))).not.toBeNull();
    expect(m.nearLimit()).toBe(true);
  });

  it('a viewer’s model refuses every step and writes nothing', () => {
    const m = modelOf(testDeck(), { readOnly: true });
    const n = notices(m);
    const before = state(m);
    expect(m.addSlide('blank')).toBeNull();
    expect(m.addElement('s1', box(0, 0))).toBeNull();
    expect(m.ensureText('s1', 'x')).toBeNull();
    expect(m.undo()).toBe(false);
    // Repeats are not repaired by a viewer either.
    orderOf(m.doc).push(['s1']);
    const withRepeat = state(m);
    m.addSlide('blank');
    expect(state(m)).toBe(withRepeat);
    expect(before).not.toBe(withRepeat);
    expect(n[0]).toEqual({ kind: 'read-only', message: 'You can view this presentation, not edit it.' });
  });
});

describe('the cascade', () => {
  it('reads theme, master, layout, in that order', () => {
    const m = modelOf();
    const s = m.addSlide('title')!;
    const [title, sub] = m.slide(s)!.elements.map((e) => e.id!);
    expect(m.styleAt(s, title!, 0)).toMatchObject({ fontFamily: 'Fraunces', fontSize: 60, bold: true, color: { theme: 'dk1' } });
    expect(m.styleAt(s, sub!, 0)).toMatchObject({ fontFamily: 'Inter', fontSize: 28, bullet: { kind: 'none' } });
    // The layout names one level for the subtitle: level 1 is the master's.
    expect(m.styleAt(s, sub!, 1)).toMatchObject({ fontSize: 22, bullet: { kind: 'char', char: '–' } });
    // Past the master's list: its last.
    expect(m.styleAt(s, sub!, 7)).toMatchObject({ fontSize: 20 });
    const free = m.addElement(s, box(0, 0))!;
    expect(m.styleAt(s, free, 0)).toMatchObject({ fontFamily: 'Inter', fontSize: 20, bullet: { kind: 'none' } });
  });
});

describe('reads and changes', () => {
  it('a slide keeps its identity until it changes, and a change names its slide', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [box(0, 0)] }, { id: 'b', layout: 'blank', elements: [box(0, 0)] }]));
    const a = m.slide('a');
    const b = m.slide('b');
    const heard: string[][] = [];
    m.subscribe((c) => heard.push([...c.slides]));
    const el = b!.elements[0]!.id!;
    m.updateElements('b', [{ id: el, patch: { x: 5 } }]);
    expect(m.slide('a')).toBe(a);
    expect(m.slide('b')).not.toBe(b);
    expect(m.slide('b')!.elements[0]!.x).toBe(5);
    expect(heard).toEqual([['b']]);
    expect(m.slideVersion('b')).toBe(1);
    expect(m.slideVersion('a')).toBe(0);
  });

  it('an element that did not change keeps its identity when another on its slide does', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [{ ...box(0, 0), id: 'p' }, { ...box(0, 0), id: 'q' }] }]));
    const p = m.element('a', 'p');
    m.updateElements('a', [{ id: 'q', patch: { y: 9 } }]);
    expect(m.element('a', 'p')).toBe(p);
  });
});

describe('undo', () => {
  it('one step is one entry, across slides, and redo puts it back', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [{ ...box(0, 0), id: 'p' }] }, { id: 'b', layout: 'blank', elements: [] }]));
    const added = m.addSlide('titleContent', 1)!;
    m.updateElements('a', [{ id: 'p', patch: { x: 50, y: 60 } }]);
    m.setText('a', 'p', txt('Hello'));
    expect(m.undo()).toBe(true);
    expect(plainText((m.element('a', 'p') as ShapeElement).text)).toBe('');
    expect(m.element('a', 'p')).toMatchObject({ x: 50, y: 60 });
    expect(m.undo()).toBe(true);
    expect(m.element('a', 'p')).toMatchObject({ x: 0, y: 0 });
    expect(m.undo()).toBe(true);
    expect(m.order()).toEqual(['a', 'b']);
    expect(m.undo()).toBe(false);
    expect(m.redo()).toBe(true);
    expect(m.order()).toEqual(['a', added, 'b']);
    expect(m.slide(added)!.elements.length).toBe(2);
    expect(m.redo()).toBe(true);
    expect(m.redo()).toBe(true);
    expect(plainText((m.element('a', 'p') as ShapeElement).text)).toBe('Hello');
  });

  it('gives back the context the editor set when the entry was made', () => {
    const m = modelOf();
    let sel = 'before';
    m.setUndoContext(() => sel);
    const back: unknown[] = [];
    m.onRestore((ctx, kind) => back.push([ctx, kind]));
    m.addElement('s1', box(0, 0));
    sel = 'after';
    m.undo();
    m.redo();
    expect(back).toEqual([
      ['before', 'undo'],
      ['after', 'redo']
    ]);
  });

  it('a repair is no entry of its own', () => {
    const m = modelOf(testDeck([{ id: 'a', layout: 'blank', elements: [] }, { id: 'b', layout: 'blank', elements: [] }]));
    orderOf(m.doc).push(['a']);
    m.addSlide('blank');
    expect(orderOf(m.doc).toArray().filter((id) => id === 'a').length).toBe(1);
    m.undo();
    expect(m.undo()).toBe(false);
  });
});

describe('a table resized by its box', () => {
  const table = (): ElementJSON => ({
    id: 't1',
    type: 'table',
    x: 100,
    y: 100,
    w: 600,
    h: 200,
    cols: [200, 400],
    rows: [
      { h: 100, cells: [{ text: txt('a') }, { text: txt('b') }] },
      { h: 100, cells: [{ text: txt('c') }, { text: txt('d') }] }
    ]
  });

  it('scales its columns and rows with it, so what is drawn is the box that was dragged', () => {
    const m = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [table()] }]));
    m.updateElements('s1', [{ id: 't1', patch: { x: 50, w: 900, h: 400 } }]);
    const t = m.element('s1', 't1');
    expect(t?.type).toBe('table');
    if (t?.type !== 'table') return;
    expect(t.cols).toEqual([300, 600]);
    expect(t.rows.map((r) => r.h)).toEqual([200, 200]);
    expect(t.w).toBe(900);
    m.undo();
    const back = m.element('s1', 't1');
    expect(back?.type === 'table' && back.cols).toEqual([200, 400]);
  });

  it('inside a group that is resized, too', () => {
    const m = modelOf(
      testDeck([{ id: 's1', layout: 'blank', elements: [{ id: 'g', type: 'group', x: 100, y: 100, w: 600, h: 200, children: [table()] }] }])
    );
    m.updateElements('s1', [{ id: 'g', patch: { w: 300, h: 100 } }]);
    const t = m.element('s1', 't1');
    expect(t?.type === 'table' && t.cols).toEqual([100, 200]);
    expect(t?.type === 'table' && t.rows.map((r) => r.h)).toEqual([50, 50]);
  });
});
