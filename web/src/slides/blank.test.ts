import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fromBase64 } from '../crypto/primitives';
import { blankDeckRequest } from './blank';
import { SlideModel } from './model/model';

describe('a blank presentation', () => {
  it('is one title slide in the default theme, as a room update', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(blankDeckRequest().state));
    const model = new SlideModel(doc, { readOnly: true });
    expect(model.order()).toHaveLength(1);
    expect(model.slide(model.order()[0]!)!.layout).toBe('title');
    expect(model.design().layouts.length).toBeGreaterThan(1);
    model.destroy();
  });
});
