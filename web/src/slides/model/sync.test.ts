import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ShapeElement, TableElement } from './deck';
import { plainText } from './schema';
import { box, docOf, peerOf, sync, testDeck, txt } from './testing';
import { SlideModel } from './model';
import { elsOf, orderOf, slidesOf, zOf } from './ydoc';

/** Two clients on one deck, offline from each other until `sync`. */
function pair(deck = testDeck(['a', 'b', 'c', 'd'].map((id) => ({ id, layout: 'blank', elements: [{ ...box(0, 0), id: `${id}1` }, { ...box(10, 10), id: `${id}2` }] })))) {
  const ada = new SlideModel(docOf(deck));
  const ben = peerOf(ada.doc);
  return { ada, ben };
}

const same = (x: SlideModel, y: SlideModel) => expect(x.deck()).toEqual(y.deck());

describe('two people at once', () => {
  it('both moving one slide leave it once, and the next step removes the repeat', () => {
    const { ada, ben } = pair();
    ada.moveSlides(['a'], 4);
    ben.moveSlides(['a'], 2);
    sync(ada.doc, ben.doc);
    expect(ada.order()).toEqual(ben.order());
    expect(ada.order().filter((id) => id === 'a')).toEqual(['a']);
    expect(orderOf(ada.doc).length).toBe(5);
    ada.addSlide('blank');
    sync(ada.doc, ben.doc);
    expect(orderOf(ada.doc).length).toBe(5);
    expect(orderOf(ben.doc).toArray()).toEqual(orderOf(ada.doc).toArray());
    same(ada, ben);
  });

  it('one moving an element and the other resizing it both land', () => {
    const { ada, ben } = pair();
    ada.updateElements('a', [{ id: 'a1', patch: { x: 300, y: 400 } }]);
    ben.updateElements('a', [{ id: 'a1', patch: { w: 640, h: 360 } }]);
    sync(ada.doc, ben.doc);
    expect(ada.element('a', 'a1')).toMatchObject({ x: 300, y: 400, w: 640, h: 360 });
    same(ada, ben);
  });

  it('a delete beats an edit made at the same time', () => {
    const { ada, ben } = pair();
    ada.deleteElements('a', ['a1']);
    ben.updateElements('a', [{ id: 'a1', patch: { x: 999 } }]);
    ben.setText('a', 'a1', txt('Lost'));
    sync(ada.doc, ben.doc);
    expect(ada.element('a', 'a1')).toBeNull();
    expect(ben.element('a', 'a1')).toBeNull();
    same(ada, ben);
  });

  it('a slide deleted while the other edits it is gone for both', () => {
    const { ada, ben } = pair();
    ada.deleteSlides(['b']);
    ben.addElement('b', box(5, 5));
    sync(ada.doc, ben.doc);
    expect(ben.order()).toEqual(['a', 'c', 'd']);
    same(ada, ben);
  });

  it('two slides added at one index both land, in the same order for both', () => {
    const { ada, ben } = pair();
    const x = ada.addSlide('blank', 1)!;
    const y = ben.addSlide('blank', 1)!;
    sync(ada.doc, ben.doc);
    expect(ada.order().length).toBe(6);
    expect(ada.order().slice(1, 3).sort()).toEqual([x, y].sort());
    same(ada, ben);
  });

  it('two people typing in two cells of one table both land', () => {
    const deck = testDeck([
      {
        id: 't',
        layout: 'blank',
        elements: [{ id: 'tb', type: 'table', x: 0, y: 0, w: 200, h: 40, cols: [100, 100], rows: [{ h: 40, cells: [{ text: txt('') }, { text: txt('') }] }] }]
      }
    ]);
    const { ada, ben } = pair(deck);
    const type = (m: SlideModel, col: number, text: string) => {
      const p = m.cellFragment('t', 'tb', 0, col)!.get(0) as Y.XmlElement;
      m.doc.transact(() => p.insert(0, [new Y.XmlText(text)]));
    };
    type(ada, 0, 'Left');
    type(ben, 1, 'Right');
    sync(ada.doc, ben.doc);
    const cells = (ben.element('t', 'tb') as TableElement).rows[0]!.cells.map((c) => plainText(c.text));
    expect(cells).toEqual(['Left', 'Right']);
    same(ada, ben);
  });

  it('one grouping while the other moves a member draws the member once', () => {
    const { ada, ben } = pair();
    ada.group('a', ['a1', 'a2']);
    ben.reorder('a', ['a1'], 'front');
    sync(ada.doc, ben.doc);
    const count = (m: SlideModel) => JSON.stringify(m.slide('a')).split('"id":"a1"').length - 1;
    expect(count(ada)).toBe(1);
    expect(count(ben)).toBe(1);
    same(ada, ben);
    // The next step on that slide removes the repeat from the raw arrays.
    ben.addElement('a', box(1, 1));
    sync(ada.doc, ben.doc);
    const slide = slidesOf(ada.doc).get('a')!;
    const z = zOf(slide)!.toArray();
    const kids = [...elsOf(slide)!.values()].flatMap((m) => (m.get('kids') as Y.Array<string> | undefined)?.toArray() ?? []);
    expect([...z, ...kids].filter((id) => id === 'a1').length).toBe(1);
    same(ada, ben);
  });

  it('undo takes back only this person’s step', () => {
    const { ada, ben } = pair();
    ada.updateElements('a', [{ id: 'a1', patch: { x: 1 } }]);
    sync(ada.doc, ben.doc);
    ben.updateElements('a', [{ id: 'a2', patch: { x: 2 } }]);
    sync(ada.doc, ben.doc);
    ada.undo();
    sync(ada.doc, ben.doc);
    expect(ben.element('a', 'a1')!.x).toBe(0);
    expect(ben.element('a', 'a2')!.x).toBe(2);
    expect(ben.canUndo()).toBe(true);
    expect(ada.canUndo()).toBe(false);
  });

  it('text two people type into one box both lands', () => {
    const { ada, ben } = pair();
    ada.setText('a', 'a1', txt('Hello'));
    sync(ada.doc, ben.doc);
    const frag = ben.textFragment('a', 'a1')!;
    const text = (frag.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    ben.doc.transact(() => text.insert(5, ' there'));
    ada.doc.transact(() => ((ada.textFragment('a', 'a1')!.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, '>'));
    sync(ada.doc, ben.doc);
    expect(plainText((ada.element('a', 'a1') as ShapeElement).text)).toBe('>Hello there');
    same(ada, ben);
  });
});
