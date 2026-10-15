import { describe, expect, it } from 'vitest';
import type { JSONContent } from '../types';
import { writeText } from './write';

const t = (c: JSONContent[]) => writeText({ body: { type: 'doc', content: c }, page: null, header: {}, footer: {} });
const p = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

describe('writeText', () => {
  it('separates blocks with a blank line and keeps lists, quotes and tables readable', () => {
    expect(
      t([
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        p('one'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('a'), { type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [p('b')] }] }] }] },
        { type: 'blockquote', content: [p('q')] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('x')] }, { type: 'tableCell', content: [p('y')] }] }] },
        { type: 'image', attrs: { alt: 'A chart' } },
        { type: 'horizontalRule' }
      ])
    ).toBe('Title\n\none\n\n• a\n   2. b\n\n> q\n\nx\ty\n\n[A chart]\n\n---\n');
  });

  it('numbers footnotes and lists them at the end', () => {
    expect(t([{ type: 'paragraph', content: [{ type: 'text', text: 'word' }, { type: 'footnote', content: [{ type: 'text', text: 'note' }] }] }])).toBe('word[1]\n\n[1] note\n');
  });

  it('resolves suggestions as accepted', () => {
    const attrs = { id: 's', authorId: 'u', authorName: 'A', at: 1 };
    expect(t([{ type: 'paragraph', content: [{ type: 'text', text: 'old ', marks: [{ type: 'deletion', attrs }] }, { type: 'text', text: 'new', marks: [{ type: 'insertion', attrs }] }] }])).toBe('new\n');
  });

  it('writes a hard break as a new line, and an empty document as one newline', () => {
    expect(t([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }])).toBe('a\nb\n');
    expect(t([{ type: 'paragraph' }])).toBe('\n');
  });
});
