// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { plainText } from '../model/schema';
import { paragraphStyle } from '../model/styles';
import { box, modelOf, testDeck, THEME, txt } from '../model/testing';
import type { SlideModel } from '../model/model';
import { editorExtensions } from './textExtensions';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = '';
});

/** A text box being typed in, bound to element `a` on slide `s1`, as the canvas makes one. */
function typingIn(model: SlideModel): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const plain = model.styleAt('s1', 'a', 0);
  editor = new Editor({
    element: host,
    extensions: editorExtensions({
      fragment: model.ensureText('s1', 'a')!,
      model,
      styleOf: (attrs) => paragraphStyle(() => plain, attrs),
      theme: THEME,
      awareness: null,
      textKey: 's1/a',
      onEscape: () => undefined,
      cascade: true
    }),
    injectCSS: false
  });
  return editor;
}

/** A key pressed in the editor, through its keymap as a person's would be. */
function press(ed: Editor, key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: mods.ctrl ?? false, shiftKey: mods.shift ?? false, bubbles: true, cancelable: true });
  return ed.view.someProp('handleKeyDown', (f) => f(ed.view, event)) ?? false;
}

const textOf = (model: SlideModel): string => {
  const el = model.element('s1', 'a');
  return el?.type === 'shape' ? plainText(el.text) : '';
};

describe('a text box being typed in', () => {
  it('shares one undo history with the canvas: Ctrl+Z undoes the typing, then the move before it', () => {
    const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(0, 0, 400, 200), id: 'a', text: txt('Hi') }] }]));
    // A step on the canvas first: the box moved.
    expect(model.updateElements('s1', [{ id: 'a', patch: { x: 100 } }])).toBe(true);
    model.breakTyping();

    const ed = typingIn(model);
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!');
    expect(textOf(model)).toBe('Hi!');

    // Ctrl+Z in the box is the deck's undo: the typing goes first, and the box stays where it was moved.
    expect(press(ed, 'z', { ctrl: true })).toBe(true);
    expect(textOf(model)).toBe('Hi');
    expect(model.element('s1', 'a')!.x).toBe(100);

    // Again, still in the box: the move is undone too, as PowerPoint does.
    press(ed, 'z', { ctrl: true });
    expect(model.element('s1', 'a')!.x).toBe(0);

    // And Ctrl+Y brings both back, in order.
    press(ed, 'y', { ctrl: true });
    expect(model.element('s1', 'a')!.x).toBe(100);
    expect(textOf(model)).toBe('Hi');
    press(ed, 'z', { ctrl: true, shift: true });
    expect(textOf(model)).toBe('Hi!');
    model.destroy();
  });
});
