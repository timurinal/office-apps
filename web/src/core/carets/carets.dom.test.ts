// @vitest-environment happy-dom
/**
 * Other people's carets are drawn beside the text, never inside it: a caret element inside the
 * editable text splits the word it sits in, and the browser's spell checker then flags "llo" in
 * "he|llo". These run the real Docs extension list and the real Slides text box binding.
 *
 * happy-dom has no layout, so where a position is drawn comes from stubs: `coordsAtPos` puts
 * position p at x = 10p, and a range of characters a..b of one text node at x = 10a to 10b.
 */

import { Editor } from '@tiptap/core';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { LAYOUT_EVENT } from '.';
import { documentExtensions } from '../../docs/extensions';
import { awarenessOf } from '../../docs/review/live';
import { editorExtensions } from '../../slides/editor/textExtensions';
import { box, modelOf, testDeck, THEME, txt } from '../../slides/model/testing';
import { paragraphStyle } from '../../slides/model/styles';
import type { SlideModel } from '../../slides/model/model';

const BEN = { name: 'Ben Okoro', color: '#0e7490' };

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;

/** A range inside one text node is drawn at 10px a character, on a line from y 20 to 40. */
function rangeRects(this: Range): DOMRect[] {
  if (this.collapsed || this.startContainer !== this.endContainer || this.startContainer.nodeType !== 3) return [];
  return [rect(this.startOffset * 10, 20, (this.endOffset - this.startOffset) * 10, 20)];
}

const saved: Record<string, unknown> = {};
beforeEach(() => {
  const range = Range.prototype as unknown as Record<string, unknown>;
  saved.getClientRects = range.getClientRects;
  saved.getBoundingClientRect = range.getBoundingClientRect;
  range.getClientRects = rangeRects;
  range.getBoundingClientRect = () => rect(0, 0, 0, 0);
  const el = Element.prototype as unknown as Record<string, unknown>;
  saved.scrollIntoView = el.scrollIntoView;
  el.scrollIntoView = () => undefined;
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = saved.getClientRects;
  range.getBoundingClientRect = saved.getBoundingClientRect;
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = saved.scrollIntoView;
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Wait for the frame the carets are drawn in (after y-tiptap's own zero timeout, for the old code). */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));
};

/** Someone else in the room: their own awareness, relayed to ours as the room relays it. */
function person(local: Awareness, state: Record<string, unknown>) {
  const remote = new Awareness(new Y.Doc());
  remote.setLocalState(state);
  const relay = () => applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remote.clientID]), 'remote');
  relay();
  cleanups.push(() => remote.destroy());
  return {
    id: remote.clientID,
    set(field: string, value: unknown) {
      remote.setLocalStateField(field, value);
      relay();
    },
    /** Their socket closed: the room says they left, as y-websocket does. */
    leave: () => removeAwarenessStates(local, [remote.clientID], 'closed')
  };
}

/** A caret, or a selection from `anchor` to `head`, as y-prosemirror sends it: relative positions in this editor's fragment. */
function cursorAt(editor: Editor, anchor: number, head = anchor) {
  const y = ySyncPluginKey.getState(editor.state)!;
  return {
    anchor: Y.relativePositionToJSON(absolutePositionToRelativePosition(anchor, y.type, y.binding.mapping)),
    head: Y.relativePositionToJSON(absolutePositionToRelativePosition(head, y.type, y.binding.mapping))
  };
}

/** Position p is drawn at x = 10p, on the line from y 20 to 40. */
function stubCoords(editor: Editor): void {
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos: number) => ({ left: pos * 10, right: pos * 10, top: 20, bottom: 40 }));
}

const textNodes = (el: Element): string[] => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n as Text).data);

// ── Docs ─────────────────────────────────────────────────────────────────────

function docsEditor(text = 'hello') {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({ element, extensions: documentExtensions({ doc, awareness, user: { name: 'Ada Rowe', color: '#7c3aed' } }) });
  editor.commands.setContent(`<p>${text}</p>`);
  stubCoords(editor);
  cleanups.push(() => {
    editor.destroy();
    awareness.destroy();
    doc.destroy();
  });
  return { editor, awareness, element };
}

describe("another person's caret in Docs", () => {
  it('leaves "he|llo" as one text node, so the spell checker reads one word, and draws the caret beside the text', async () => {
    const { editor, awareness, element } = docsEditor();
    person(awareness, { user: BEN, cursor: cursorAt(editor, 3) });
    await settle();

    const p = editor.view.dom.querySelector('p')!;
    expect(p.childNodes).toHaveLength(1);
    expect(textNodes(p)).toEqual(['hello']);
    expect(editor.view.dom.querySelector('.oa-caret, .collaboration-carets__caret, .ProseMirror-yjs-cursor')).toBeNull();

    const caret = element.querySelector('.oa-carets .oa-caret') as HTMLElement;
    expect(caret).not.toBeNull();
    expect(caret.querySelector('.oa-caret-label')!.textContent).toBe('Ben Okoro');
    expect(caret.style.transform).toBe('translate(30px, 20px)');
    // The layers are beside the editor's root, hidden from assistive technology and the pointer.
    const layer = caret.closest('.oa-carets')!;
    expect(layer.parentElement).toBe(editor.view.dom.parentElement);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  it("draws their selection as rectangles under the text, and changes nothing in the paragraph", async () => {
    const { editor, awareness, element } = docsEditor();
    person(awareness, { user: BEN, cursor: cursorAt(editor, 2, 5) });
    await settle();

    expect(textNodes(editor.view.dom.querySelector('p')!)).toEqual(['hello']);
    const sels = [...element.querySelectorAll<HTMLElement>('.oa-carets-under .oa-caret-sel')];
    // Characters 1 to 4 of "hello" ("ell"), at 10px each.
    expect(sels).toHaveLength(1);
    expect(sels[0]!.style.transform).toBe('translate(10px, 20px)');
    expect(sels[0]!.style.width).toBe('30px');
    expect(sels[0]!.style.height).toBe('20px');
    // Under the text: the selection layer comes before the editor's root, the carets after it.
    expect(editor.view.dom.previousElementSibling?.classList.contains('oa-carets-under')).toBe(true);
  });

  it('moves the caret when their awareness says it moved, and removes it when they leave', async () => {
    const { editor, awareness, element } = docsEditor();
    const ben = person(awareness, { user: BEN, cursor: cursorAt(editor, 3) });
    await settle();
    ben.set('cursor', cursorAt(editor, 5));
    await settle();
    const carets = element.querySelectorAll<HTMLElement>('.oa-caret');
    expect(carets).toHaveLength(1);
    expect(carets[0]!.style.transform).toBe('translate(50px, 20px)');

    ben.leave();
    await settle();
    expect(element.querySelector('.oa-caret')).toBeNull();
  });

  it('measures again when the pages are laid out again, which moves the text with no transaction', async () => {
    const { editor, awareness, element } = docsEditor();
    const laidOut = vi.fn();
    editor.view.dom.addEventListener(LAYOUT_EVENT, laidOut);
    person(awareness, { user: BEN, cursor: cursorAt(editor, 3) });
    await settle();
    // The pagination pass after a transaction says so. Web layout, because a page waits here for a
    // width that a DOM without layout never has.
    editor.commands.setPaged(false);
    await settle();
    laidOut.mockClear();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    await settle();
    expect(laidOut).toHaveBeenCalled();

    // A header grew: the text is 30px lower, and nothing else happened.
    vi.mocked(editor.view.coordsAtPos).mockImplementation((pos: number) => ({ left: pos * 10, right: pos * 10, top: 50, bottom: 70 }));
    editor.view.dom.dispatchEvent(new Event(LAYOUT_EVENT));
    await settle();
    expect(element.querySelector<HTMLElement>('.oa-caret')!.style.transform).toBe('translate(30px, 50px)');
  });

  it('keeps the room reachable for the comments nudge (review/live.ts finds it through the caret extension)', () => {
    const { editor, awareness } = docsEditor();
    expect(awarenessOf(editor)).toBe(awareness);
  });
});

// ── Slides ───────────────────────────────────────────────────────────────────

function slidesEditor(model: SlideModel, awareness: Awareness, key: string | null = 's1/a') {
  const host = document.body.appendChild(document.createElement('div'));
  host.className = 'sl-text';
  const plain = model.styleAt('s1', 'a', 0);
  const editor = new Editor({
    element: host,
    extensions: editorExtensions({
      fragment: model.ensureText('s1', 'a')!,
      model,
      styleOf: (attrs) => paragraphStyle(() => plain, attrs),
      theme: THEME,
      awareness,
      textKey: key,
      onEscape: () => undefined,
      cascade: true
    }),
    injectCSS: false
  });
  stubCoords(editor);
  cleanups.push(() => {
    editor.destroy();
    awareness.destroy();
    model.destroy();
  });
  return { editor, host };
}

describe("another person's caret in a Slides text box", () => {
  it('is drawn beside the text of the box they are typing in, and the word stays whole', async () => {
    const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0, 400, 200), id: 'a', text: txt('hello') }] }]));
    const awareness = new Awareness(model.doc);
    const { editor, host } = slidesEditor(model, awareness);
    person(awareness, { user: BEN, slides: { slide: 's1', els: ['a'], text: 's1/a' }, cursor: cursorAt(editor, 3) });
    // Someone typing in another box of the same slide is not drawn in this one.
    person(awareness, { user: { name: 'Cleo Park', color: '#be123c' }, slides: { slide: 's1', els: ['b'], text: 's1/b' }, cursor: cursorAt(editor, 1) });
    await settle();

    const p = editor.view.dom.querySelector('p')!;
    expect(textNodes(p)).toEqual(['hello']);
    expect(editor.view.dom.querySelector('.oa-caret, .sl-caret')).toBeNull();
    const carets = [...host.querySelectorAll<HTMLElement>('.oa-carets .oa-caret')];
    expect(carets.map((c) => c.querySelector('.oa-caret-label')!.textContent)).toEqual(['Ben Okoro']);
    expect(carets[0]!.style.transform).toBe('translate(30px, 20px)');
  });

  it('in a turned box, measures the text with the turn taken off, and puts the turn back', async () => {
    const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0, 400, 200), id: 'a', text: txt('hello') }] }]));
    const awareness = new Awareness(model.doc);
    const { editor, host } = slidesEditor(model, awareness);
    const turn = document.body.appendChild(document.createElement('div'));
    turn.className = 'sl-edit-box';
    turn.style.transform = 'rotate(90deg)';
    turn.appendChild(host);
    const turned = () => turn.style.transform.includes('rotate');
    // Turned a quarter, the layer's x axis runs down the screen; the text's client rectangles are
    // its bounding boxes, nowhere near where a caret goes.
    const bounds = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('oa-carets-probe')) return turned() ? rect(0, -1000, 0, 0) : rect(-1000, 0, 0, 0);
      return bounds.call(this);
    });
    vi.mocked(editor.view.coordsAtPos).mockImplementation((pos: number) =>
      turned() ? { left: 999, right: 999, top: 999, bottom: 999 } : { left: pos * 10, right: pos * 10, top: 20, bottom: 40 }
    );
    person(awareness, { user: BEN, slides: { slide: 's1', els: ['a'], text: 's1/a' }, cursor: cursorAt(editor, 3) });
    await settle();

    expect(host.querySelector<HTMLElement>('.oa-caret')!.style.transform).toBe('translate(30px, 20px)');
    expect(turn.style.transform).toBe('rotate(90deg)');
  });

  it("in a table cell, which nobody's `slides.text` names, draws whoever's caret is in its own text", async () => {
    const model = modelOf(
      testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0, 400, 200), id: 'a', text: txt('hello') }, { ...box(0, 300, 400, 100), id: 'b', text: txt('other') }] }])
    );
    const awareness = new Awareness(model.doc);
    const { editor, host } = slidesEditor(model, awareness, null);
    const inCell = { slide: 's1', els: [], text: null };
    person(awareness, { user: BEN, slides: inCell, cursor: cursorAt(editor, 3) });
    const elsewhere = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(model.ensureText('s1', 'b')!, 0));
    person(awareness, { user: { name: 'Cleo Park', color: '#be123c' }, slides: inCell, cursor: { anchor: elsewhere, head: elsewhere } });
    await settle();

    expect(textNodes(editor.view.dom.querySelector('p')!)).toEqual(['hello']);
    expect([...host.querySelectorAll('.oa-caret-label')].map((l) => l.textContent)).toEqual(['Ben Okoro']);
  });
});

// ── The caret's motion and what this client tells the room ──────────────────

describe('the remote caret', () => {
  it("glides when the other person moves it, and jumps when typing here moves it", async () => {
    const { editor, awareness, element } = docsEditor();
    const ben = person(awareness, { user: BEN, cursor: cursorAt(editor, 3) });
    await settle();
    const caret = element.querySelector<HTMLElement>('.oa-caret')!;
    const animate = vi.spyOn(caret, 'animate');

    ben.set('cursor', cursorAt(editor, 5));
    await settle();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([{ transform: 'translate(30px, 20px)' }, { transform: 'translate(50px, 20px)' }]);

    // Typing at the start of the paragraph moves Ben's caret along with his text, at once.
    editor.commands.insertContentAt(1, 'Oh, ');
    await settle();
    expect(caret.style.transform).toBe('translate(90px, 20px)');
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('jumps under reduced motion', async () => {
    document.documentElement.dataset.motion = 'off';
    const { editor, awareness, element } = docsEditor();
    const ben = person(awareness, { user: BEN, cursor: cursorAt(editor, 3) });
    await settle();
    const caret = element.querySelector<HTMLElement>('.oa-caret')!;
    const animate = vi.spyOn(caret, 'animate');
    ben.set('cursor', cursorAt(editor, 5));
    await settle();
    expect(caret.style.transform).toBe('translate(50px, 20px)');
    expect(animate).not.toHaveBeenCalled();
  });

  it("tells the room this person's name and caret in the fields older clients read", async () => {
    const { editor, awareness } = docsEditor();
    const state = () => awareness.getLocalState() as { user?: unknown; cursor?: { anchor: unknown; head: unknown } | null };
    expect(state().user).toEqual({ name: 'Ada Rowe', color: '#7c3aed' });

    editor.view.focus();
    editor.commands.setTextSelection({ from: 2, to: 4 });
    const y = ySyncPluginKey.getState(editor.state)!;
    const abs = (rel: unknown) => relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromJSON(rel), y.binding.mapping);
    expect(editor.view.hasFocus()).toBe(true);
    expect(abs(state().cursor!.anchor)).toBe(2);
    expect(abs(state().cursor!.head)).toBe(4);

    editor.view.dom.blur();
    editor.view.dom.dispatchEvent(new FocusEvent('focusout'));
    expect(state().cursor).toBeNull();

    // Closing the editor takes this person's caret out of the room.
    editor.view.focus();
    editor.commands.setTextSelection(3);
    expect(abs(state().cursor!.head)).toBe(3);
    editor.destroy();
    expect(state().cursor).toBeNull();
  });
});
