// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { jsonOf, makeEditor, type TestEditor } from './core/testing';

let t: TestEditor | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

/** A document, as another person's client wrote it, that ends in a list with nothing after it. */
function endsInAList(): Uint8Array {
  const y = new Y.Doc();
  const fragment = y.getXmlFragment('default');
  const el = (name: string, ...kids: Array<Y.XmlElement | Y.XmlText>) => {
    const e = new Y.XmlElement(name);
    e.insert(0, kids);
    return e;
  };
  fragment.insert(0, [el('paragraph', new Y.XmlText('Intro')), el('bulletList', el('listItem', el('paragraph', new Y.XmlText('Last item'))))]);
  return Y.encodeStateAsUpdate(y);
}

const kinds = (e: TestEditor) => (jsonOf(e.editor).content ?? []).map((n) => n.type);
const stored = (e: TestEditor) => e.doc.getXmlFragment('default').length;

describe('a read-only page', () => {
  it('does not add a trailing paragraph, so a viewer writes nothing to the shared document', () => {
    t = makeEditor();
    t.editor.setEditable(false);
    const writes: unknown[] = [];
    t.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') writes.push(origin);
    });

    Y.applyUpdate(t.doc, endsInAList(), 'remote');

    expect(kinds(t)).toEqual(['paragraph', 'bulletList']);
    expect(stored(t)).toBe(2);
    expect(writes).toEqual([]);
  });

  it('still shows what other people write', () => {
    t = makeEditor();
    t.editor.setEditable(false);
    Y.applyUpdate(t.doc, endsInAList(), 'remote');
    expect(t.editor.getText()).toContain('Last item');
  });

  it('leaves an editable page as it was: it appends the paragraph, so there is somewhere to type after a list', () => {
    t = makeEditor();
    Y.applyUpdate(t.doc, endsInAList(), 'remote');
    expect(kinds(t)).toEqual(['paragraph', 'bulletList', 'paragraph']);
  });

  it('is editable again when the role is, and then the paragraph comes', () => {
    t = makeEditor();
    t.editor.setEditable(false);
    Y.applyUpdate(t.doc, endsInAList(), 'remote');
    t.editor.setEditable(true);
    t.editor.commands.insertContentAt(t.editor.state.doc.content.size, { type: 'paragraph' });
    expect(stored(t)).toBeGreaterThanOrEqual(3);
  });
});
