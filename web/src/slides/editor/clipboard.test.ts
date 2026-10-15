import { describe, expect, it } from 'vitest';
import type { ElementJSON, SlideJSON } from '../model/deck';
import { plainText } from '../model/schema';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { copyPayload, encodeClip, parsePayload, pasteFrom, pasteOffset, payloadFromHtml, readClip, removeCopied, SLIDES_MIME, textOf, withoutPictures, type ClipTarget } from './clipboard';
import { SelectionStore } from './selection';

const picture: ElementJSON = { id: 'p', type: 'image', x: 0, y: 0, w: 10, h: 10, asset: { id: 'ast_1' } };

function target(slides: SlideJSON[], doc = 'doc_a'): ClipTarget {
  const model = modelOf(testDeck(slides));
  const selection = new SelectionStore();
  selection.set({ slide: slides[0]!.id!, slides: [slides[0]!.id!] });
  return { model, selection, doc };
}

describe('the payload', () => {
  it('goes out as our type, as HTML that carries it, and as the shapes’ text', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [{ ...box(1, 2), id: 'a', text: txt('Hello <b>', 'world') }] }]);
    t.selection.set({ els: ['a'], focus: 'canvas' });
    const forms = encodeClip(copyPayload(t)!);
    expect(forms.text).toBe('Hello <b>\nworld');
    expect(forms.html).not.toContain('<b>');
    const fromHtml = payloadFromHtml(forms.html)!;
    expect(fromHtml.kind).toBe('elements');
    expect((fromHtml.items[0] as ElementJSON).x).toBe(1);
    const data = { getData: (type: string) => (type === SLIDES_MIME ? forms.json : '') };
    expect(readClip(data)!.items).toHaveLength(1);
  });

  it('copies slides from the rail', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }]);
    t.selection.set({ focus: 'rail' });
    expect(copyPayload(t)!.kind).toBe('slides');
  });

  it('reads nothing it did not write', () => {
    expect(parsePayload('{"v":2,"kind":"elements","doc":"d","items":[{"type":"shape"}]}')).toBeNull();
    expect(parsePayload('{"v":1,"kind":"slides","doc":"d","items":[{"elements":"no"}]}')).toBeNull();
    expect(parsePayload('{"v":1,"kind":"elements","doc":"d","items":[]}')).toBeNull();
    expect(parsePayload('not json')).toBeNull();
    expect(payloadFromHtml('<div data-oa-slides="!!!">')).toBeNull();
  });

  it('collects text from groups and tables', () => {
    const group: ElementJSON = { type: 'group', x: 0, y: 0, w: 1, h: 1, children: [{ ...box(0, 0), text: txt('in a group') }] };
    const table: ElementJSON = { type: 'table', x: 0, y: 0, w: 1, h: 1, cols: [1], rows: [{ h: 1, cells: [{ text: txt('cell') }] }] };
    expect(textOf([group, table])).toBe('in a group\ncell');
  });
});

describe('pasting', () => {
  it('pastes elements with new ids, 20 px off a copy that is already there, and chooses them', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [{ ...box(100, 100), id: 'a' }] }]);
    t.selection.set({ els: ['a'], focus: 'canvas' });
    const forms = encodeClip(copyPayload(t)!);
    const first = pasteFrom(t, { json: forms.json })!;
    const second = pasteFrom(t, { json: forms.json })!;
    const els = t.model.slide('s1')!.elements;
    expect(els.map((e) => [e.x, e.y])).toEqual([[100, 100], [120, 120], [140, 140]]);
    expect(new Set(els.map((e) => e.id)).size).toBe(3);
    expect(t.selection.get().els).toEqual(second.ids);
    expect(first.droppedPictures).toBe(false);
  });

  it('a paste in another slide lands where it was', () => {
    expect(pasteOffset([box(0, 0)], [box(50, 50)])).toBe(0);
  });

  it('leaves out pictures from another presentation, and says so', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }]);
    const payload = { v: 1, kind: 'elements', doc: 'doc_b', items: [picture, { ...box(0, 0), fill: { kind: 'image', asset: { id: 'x' }, fit: 'cover' } }] };
    const r = pasteFrom(t, { json: JSON.stringify(payload) })!;
    expect(r.droppedPictures).toBe(true);
    const els = t.model.slide('s1')!.elements;
    expect(els.map((e) => e.type)).toEqual(['shape']);
    expect((els[0] as { fill?: unknown }).fill).toBeUndefined();
  });

  it('keeps pictures pasted into the presentation they came from', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }]);
    const r = pasteFrom(t, { json: JSON.stringify({ v: 1, kind: 'elements', doc: 'doc_a', items: [picture] }) })!;
    expect(r.droppedPictures).toBe(false);
    expect(t.model.slide('s1')!.elements.map((e) => e.type)).toEqual(['image']);
  });

  it('a group of only pictures goes with them', () => {
    const g: ElementJSON = { type: 'group', x: 0, y: 0, w: 1, h: 1, children: [picture] };
    expect(withoutPictures([g])).toEqual({ els: [], dropped: true });
  });

  it('pastes slides after the slide on the canvas', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }, { id: 's2', layout: 'blank', elements: [] }]);
    const payload = { v: 1, kind: 'slides', doc: 'doc_a', items: [{ id: 'x', layout: 'titleContent', elements: [box(5, 5)] }] };
    const r = pasteFrom(t, { json: JSON.stringify(payload) })!;
    expect(t.model.order()).toEqual(['s1', r.ids[0], 's2']);
    expect(t.selection.get()).toMatchObject({ slide: r.ids[0], focus: 'rail' });
  });

  it('text from elsewhere becomes a text box', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }]);
    const r = pasteFrom(t, { html: '<p>no payload</p>', text: 'One\r\nTwo' })!;
    expect(r.kind).toBe('text');
    const el = t.model.element('s1', r.ids[0]!)!;
    expect(el.type === 'shape' && plainText(el.text)).toBe('One\nTwo');
  });

  it('a reader pastes nothing', () => {
    const model = modelOf(testDeck(), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 's1', slides: ['s1'] });
    expect(pasteFrom({ model, selection, doc: 'd' }, { text: 'x' })).toBeNull();
  });
});

describe('cutting', () => {
  it('removes the elements that were copied, as one step', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0), id: 'a' }, { ...box(50, 0), id: 'b' }] }]);
    t.selection.set({ els: ['a'], focus: 'canvas' });
    const payload = copyPayload(t)!;
    expect(removeCopied(t, payload.kind)).toBe(true);
    expect(t.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['b']);
    t.model.undo();
    expect(t.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('removes the slides that were copied from the rail', () => {
    const t = target([{ id: 's1', layout: 'blank', elements: [] }, { id: 's2', layout: 'blank', elements: [] }]);
    t.selection.set({ focus: 'rail' });
    expect(removeCopied(t, copyPayload(t)!.kind)).toBe(true);
    expect(t.model.order()).toEqual(['s2']);
  });
});
