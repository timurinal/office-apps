import { describe, expect, it } from 'vitest';
import type { TextDoc } from '../model/deck';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { linkOf, setLink, shapesIn } from './linkText';

const doc = (...paras: TextDoc['content'][]): TextDoc => ({ type: 'doc', content: paras.map((content) => ({ type: 'paragraph', content })) });

describe('a link on the whole text', () => {
  it('goes on every run, keeping the marks they had, and comes off them all', () => {
    const d = doc([{ type: 'text', text: 'Read ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'this' }], [{ type: 'text', text: 'too' }]);
    const linked = setLink(d, 'https://example.com/');
    const marks = linked.content.flatMap((p) => p.content!.map((r) => r.marks));
    expect(marks).toEqual([
      [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/' } }],
      [{ type: 'link', attrs: { href: 'https://example.com/' } }],
      [{ type: 'link', attrs: { href: 'https://example.com/' } }]
    ]);
    expect(linkOf(linked)).toBe('https://example.com/');
    const bare = setLink(linked, null);
    expect(bare.content.flatMap((p) => p.content!.map((r) => r.marks))).toEqual([[{ type: 'bold' }], undefined, undefined]);
    expect(linkOf(bare)).toBeNull();
  });

  it('replaces a link a run already had, and leaves the tree it was given as it was', () => {
    const d = doc([{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'https://old.example/' } }] }]);
    const before = JSON.stringify(d);
    expect(linkOf(setLink(d, 'https://new.example/'))).toBe('https://new.example/');
    expect(JSON.stringify(d)).toBe(before);
  });

  it('is read as one address only when every run has it', () => {
    const a = { type: 'link', attrs: { href: 'https://a.example/' } };
    const b = { type: 'link', attrs: { href: 'https://b.example/' } };
    expect(linkOf(doc([{ type: 'text', text: 'x', marks: [a] }, { type: 'text', text: 'y', marks: [a] }]))).toBe('https://a.example/');
    expect(linkOf(doc([{ type: 'text', text: 'x', marks: [a] }, { type: 'text', text: 'y', marks: [b] }]))).toBeNull();
    expect(linkOf(doc([{ type: 'text', text: 'x', marks: [a] }, { type: 'text', text: 'y' }]))).toBeNull();
    expect(linkOf(doc())).toBeNull();
  });

  it('finds the shapes among the chosen, in groups too', () => {
    const m = modelOf(
      testDeck([
        {
          id: 's1',
          layout: 'blank',
          elements: [
            { ...box(0, 0, 100, 100), id: 'a', text: txt('A') },
            { type: 'group', id: 'g', x: 0, y: 0, w: 200, h: 100, children: [{ ...box(0, 0, 100, 100), id: 'b', text: txt('B') }] },
            { type: 'image', id: 'i', x: 0, y: 0, w: 10, h: 10, asset: { id: 'x' } }
          ]
        }
      ])
    );
    const els = ['a', 'g', 'i'].map((id) => m.element('s1', id));
    expect(shapesIn(els).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
