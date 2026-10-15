// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { makeEditor, jsonOf } from './core/testing';
import { seedState } from './seed';

let editor: ReturnType<typeof makeEditor> | null = null;
afterEach(() => editor?.destroy());

const text = (t: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('a seeded document, opened in the editor', () => {
  it('reads as the content that was seeded, attributes, marks and chips included', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
        { type: 'paragraph', attrs: { textAlign: 'right', lineHeight: 2 }, content: [text('rich', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '18pt', color: '#c0392b' } }]), { type: 'mention', attrs: { id: 'u1', label: 'Ada Rowe' } }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { backgroundColor: '#e7f5ee' }, content: [{ type: 'paragraph', content: [text('cell')] }] }] }] }
      ]
    };
    editor = makeEditor();
    Y.applyUpdate(editor.doc, seedState(json));
    const got = jsonOf(editor.editor);
    // The table is last, so the seed ended the document with a paragraph to type in.
    expect(got.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'table', 'paragraph']);
    expect(got.content![0]!.attrs).toMatchObject({ level: 2 });
    expect(got.content![1]!.attrs).toMatchObject({ textAlign: 'right', lineHeight: 2 });
    expect(JSON.stringify(got)).toContain('#c0392b');
    expect(JSON.stringify(got)).toContain('#e7f5ee');
    expect(editor.editor.getText()).toContain('@Ada Rowe');
  });

  it('adds the paragraph after a table itself, so the editor has none to add when it opens', () => {
    editor = makeEditor();
    Y.applyUpdate(editor.doc, seedState({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] }] }));
    expect(jsonOf(editor.editor).content!.map((n) => n.type)).toEqual(['table', 'paragraph']);
  });

  it('is replaced, not merged, when a room applies it to a document that has content', () => {
    // What the room's `import:` edit does: delete what is there, then apply the update.
    editor = makeEditor();
    editor.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [text('old')] }] });
    const seeded = seedState({ type: 'doc', content: [{ type: 'paragraph', content: [text('new')] }] });
    editor.doc.transact(() => {
      const fragment = editor!.doc.getXmlFragment('default');
      fragment.delete(0, fragment.length);
      Y.applyUpdate(editor!.doc, seeded);
    });
    expect(editor.editor.getText()).toBe('new');
  });
});
