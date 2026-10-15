// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alignAt } from './text';
import { styleAt } from './paragraph';
import { uiOf } from './ui';
import { docOf, h, makeEditor, p, select, type TestEditor, jsonOf } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

/** A key pressed in the page, as the browser would send it. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  t.editor.view.dom.dispatchEvent(e);
  return e;
}

describe('Word’s shortcuts', () => {
  it('centres with Ctrl+E and justifies with Ctrl+J, as Word does', () => {
    t = makeEditor(docOf(p('Align me')));
    select(t.editor, 'Align');
    for (const [key, to] of [['e', 'center'], ['j', 'justify']] as const) {
      expect(press(key, { ctrlKey: true }).defaultPrevented, key).toBe(true);
      expect(alignAt(t.editor), key).toBe(to);
    }
  });

  it('keeps Docs’ Ctrl+Shift+L, E, R and J, which are safe in every browser', () => {
    t = makeEditor(docOf(p('Align me')));
    select(t.editor, 'Align');
    for (const [key, to] of [['e', 'center'], ['r', 'right'], ['j', 'justify'], ['l', 'left']] as const) {
      press(key, { ctrlKey: true, shiftKey: true });
      expect(alignAt(t.editor), key).toBe(to);
    }
  });

  it('leaves Ctrl+L, Ctrl+R and Ctrl+=, which are the address bar, reload and zoom, to the browser', () => {
    t = makeEditor(docOf(p('Words here')));
    select(t.editor, 'Words');
    for (const [key, init] of [['l', {}], ['r', {}], ['=', {}], ['+', { shiftKey: true }]] as const) {
      const e = press(key, { ctrlKey: true, ...init });
      expect(e.defaultPrevented, key).toBe(false);
    }
    expect(alignAt(t.editor)).toBe('left');
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('subscript');
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('superscript');
  });

  it('indents with Ctrl+M and outdents with Ctrl+Shift+M', () => {
    t = makeEditor(docOf(p('Indent me')));
    select(t.editor, 'Indent');
    press('m', { ctrlKey: true });
    expect(jsonOf(t.editor).content![0]!.attrs!.indent).toBe(1);
    press('m', { ctrlKey: true, shiftKey: true });
    expect(jsonOf(t.editor).content![0]!.attrs!.indent).toBe(0);
  });

  it('keeps what the base list binds: headings, lists, and bold', () => {
    t = makeEditor(docOf(p('Words here')));
    select(t.editor, 'Words');
    press('2', { ctrlKey: true, altKey: true, code: 'Digit2' });
    expect(styleAt(t.editor.state)).toBe('h2');
    press('0', { ctrlKey: true, altKey: true, code: 'Digit0' });
    expect(styleAt(t.editor.state)).toBe('normal');
    press('8', { ctrlKey: true, shiftKey: true, code: 'Digit8' });
    expect(jsonOf(t.editor).content![0]!.type).toBe('bulletList');
    press('7', { ctrlKey: true, shiftKey: true, code: 'Digit7' });
    expect(jsonOf(t.editor).content![0]!.type).toBe('orderedList');
    press('9', { ctrlKey: true, shiftKey: true, code: 'Digit9' });
    expect(jsonOf(t.editor).content![0]!.type).toBe('taskList');
  });

  it('clears formatting with Ctrl+Space and strikes through with Ctrl+Shift+X', () => {
    t = makeEditor(docOf(h(2, 'Head'), { type: 'paragraph', content: [{ type: 'text', text: 'rich', marks: [{ type: 'bold' }] }] }));
    select(t.editor, 'rich');
    press('x', { ctrlKey: true, shiftKey: true });
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"strike"');
    press(' ', { ctrlKey: true, code: 'Space' });
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('"strike"');
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('"bold"');
  });

  it('subscripts with Ctrl+, and superscripts with Ctrl+.', () => {
    t = makeEditor(docOf(p('H2O and x2')));
    select(t.editor, '2O');
    press(',', { ctrlKey: true });
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"subscript"');
    select(t.editor, 'x2');
    press('.', { ctrlKey: true });
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"superscript"');
  });
});

describe('Ctrl+K', () => {
  it('opens the link popover in the page, and the command box never hears it', () => {
    t = makeEditor(docOf(p('Link me')));
    select(t.editor, 'Link');
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    const e = press('k', { ctrlKey: true });
    document.removeEventListener('keydown', heard);
    expect(e.defaultPrevented).toBe(true);
    expect(uiOf(t.editor).get().link).toBe(true);
    expect(heard).not.toHaveBeenCalled();
  });

  it('means ⌘K on a Mac', () => {
    t = makeEditor(docOf(p('Link me')));
    press('k', { metaKey: true });
    expect(uiOf(t.editor).get().link).toBe(true);
  });

  it('leaves Ctrl+Shift+K and Ctrl+Alt+K alone', () => {
    t = makeEditor(docOf(p('Link me')));
    press('k', { ctrlKey: true, shiftKey: true });
    press('k', { ctrlKey: true, altKey: true });
    expect(uiOf(t.editor).get().link).toBe(false);
  });

  it('is the command box for a reader, who has no page to type in', () => {
    t = makeEditor(docOf(p('Read me')));
    t.editor.setEditable(false);
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    press('k', { ctrlKey: true });
    document.removeEventListener('keydown', heard);
    expect(uiOf(t.editor).get().link).toBe(false);
    expect(heard).toHaveBeenCalled();
  });

  it('puts the caret in the command box on Ctrl+/', () => {
    t = makeEditor(docOf(p('Words')));
    const box = document.createElement('input');
    box.setAttribute('role', 'combobox');
    box.setAttribute('aria-label', 'Search or run a command');
    document.body.appendChild(box);
    const e = press('/', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(box);
    box.remove();
  });
});
