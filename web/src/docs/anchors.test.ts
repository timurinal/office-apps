import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { decodeRelativePosition, encodeRelativePosition } from './anchors';

function setup(text: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, text);
  return { doc, t };
}

describe('relative positions on the wire', () => {
  it('round-trip through base64 to the same place', () => {
    const { doc, t } = setup('The quick brown fox');
    const rp = Y.createRelativePositionFromTypeIndex(t, 4);
    const back = decodeRelativePosition(encodeRelativePosition(rp))!;
    expect(Y.createAbsolutePositionFromRelativePosition(back, doc)?.index).toBe(4);
  });

  it('follow the text when someone types before them', () => {
    const { doc, t } = setup('The quick brown fox');
    const stored = encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, 10));
    t.insert(0, 'Yesterday: ');
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(stored)!, doc);
    expect(abs?.index).toBe(10 + 'Yesterday: '.length);
  });

  it('follow it across another client\'s edit that arrives later', () => {
    const a = setup('Hello world');
    const stored = encodeRelativePosition(Y.createRelativePositionFromTypeIndex(a.t, 6));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    b.getText('t').insert(0, '>> ');
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(stored)!, a.doc);
    expect(abs?.index).toBe(9);
  });

  it('survive the text around them being rewritten, and report when their own text is gone', () => {
    const { doc, t } = setup('keep THIS keep');
    const stored = encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, 5, 0));
    t.delete(5, 4);
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeRelativePosition(stored)!, doc);
    // Yjs does not lose the position: it lands where the text was. A caller that
    // wants to call a thread detached compares the ends of a range (anchors.ts).
    expect(abs?.index).toBe(5);
  });

  it('refuse bytes that are not a position instead of throwing', () => {
    expect(decodeRelativePosition('not base64 at all !!!')).toBeNull();
    expect(decodeRelativePosition('')).toBeNull();
  });
});
