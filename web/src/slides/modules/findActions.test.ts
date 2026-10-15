import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@shared/api';
import type { ElementJSON, SlideJSON, TextDoc, TextNode } from '../model/deck';
import { plainText } from '../model/schema';
import { box, modelOf, testDeck, txt } from '../model/testing';
import {
  DEFAULT_FIND,
  bodiesOf,
  comparePositions,
  findAll,
  findInDoc,
  matchKey,
  paragraphOf,
  paragraphText,
  pattern,
  positionOf,
  replaceAll,
  replaceInDoc,
  replaceOne,
  replaceRanges,
  replacedText,
  startOfSlide,
  stepMatch,
  type FindOptions,
  type Match
} from './findActions';

const opts = (query: string, extra: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND, query, ...extra });

const run = (text: string, ...marks: string[]): TextNode => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const para = (...content: TextNode[]): TextNode => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const doc = (...paras: TextNode[]): TextDoc => ({ type: 'doc', content: paras });
const brk: TextNode = { type: 'hardBreak' };

const shape = (id: string, text: TextDoc, x = 0): ElementJSON => ({ ...box(x, 0), id, text }) as ElementJSON;

const slide = (id: string, elements: ElementJSON[], notes?: TextDoc): SlideJSON => ({ id, layout: 'blank', elements, ...(notes ? { notes } : {}) });

/** Texts of every shape and the notes that say something, as the deck holds them. */
function texts(m: ReturnType<typeof modelOf>): string[] {
  const out: string[] = [];
  for (const id of m.order()) {
    const s = m.slide(id)!;
    for (const b of bodiesOf(s, true)) if (plainText(b.doc) !== '') out.push(plainText(b.doc));
  }
  return out;
}

describe('what a search looks for', () => {
  it('is nothing for an empty query', () => {
    expect(pattern(opts(''))).toBeNull();
  });

  it('takes the query literally, not as a pattern', () => {
    const re = pattern(opts('a.b (c)+'))!;
    expect(findInDoc(doc(para(run('xa.b (c)+x aXb (c)+'))), re)).toEqual([{ para: 0, start: 1, end: 9 }]);
  });

  it('ignores case unless asked, in any script', () => {
    const d = doc(para(run('Hello hello HELLO Ärger ärger')));
    expect(findInDoc(d, pattern(opts('hello'))!)).toHaveLength(3);
    expect(findInDoc(d, pattern(opts('hello', { matchCase: true }))!)).toEqual([{ para: 0, start: 6, end: 11 }]);
    expect(findInDoc(d, pattern(opts('ärger'))!)).toHaveLength(2);
  });

  it('whole words are not found inside longer ones', () => {
    const d = doc(para(run('the cat concatenates cats, a cat_x and a cat.')));
    const found = findInDoc(d, pattern(opts('cat', { wholeWord: true }))!);
    expect(found.map((f) => f.start)).toEqual([4, 41]);
    expect(findInDoc(d, pattern(opts('cat'))!).length).toBeGreaterThan(found.length);
  });
});

describe('finding in a deck', () => {
  const build = () =>
    modelOf(
      testDeck([
        slide('s1', [shape('a', txt('Hello there', 'and hello again')), shape('b', txt('nothing here'), 200)], txt('Say hello first')),
        slide('s2', [shape('c', txt('Goodbye'))]),
        slide(
          's3',
          [
            {
              ...box(0, 0, 400, 100),
              id: 'g',
              type: 'group',
              children: [{ ...shape('kid', txt('A HELLO in a group'), 10) }]
            } as ElementJSON,
            {
              ...box(0, 200, 200, 100),
              id: 't',
              type: 'table',
              cols: [100, 100],
              rows: [{ h: 50, cells: [{ text: txt('table hello') }, { text: txt('hello hidden'), merged: true }] }]
            } as ElementJSON
          ],
          txt('notes: hello')
        )
      ])
    );

  it('finds in shapes, a group’s children, table cells and notes, in reading order', () => {
    const m = build();
    const found = findAll(m, opts('hello'));
    expect(found.map((f) => [f.slide, f.place.kind === 'notes' ? 'notes' : f.place.el, f.para, f.start])).toEqual([
      ['s1', 'a', 0, 0],
      ['s1', 'a', 1, 4],
      ['s1', 'notes', 0, 4],
      ['s3', 'kid', 0, 2],
      ['s3', 't', 0, 6],
      ['s3', 'notes', 0, 7]
    ]);
    // The table's merged cell is covered by the merge, and is not searched.
    expect(found.some((f) => f.place.kind === 'cell' && f.place.col === 1)).toBe(false);
    m.destroy();
  });

  it('leaves the notes out when asked to', () => {
    const m = build();
    const found = findAll(m, opts('hello', { notes: false }));
    expect(found.some((f) => f.place.kind === 'notes')).toBe(false);
    expect(found).toHaveLength(4);
    m.destroy();
  });

  it('numbers matches by slide and by body, so reading order can be compared', () => {
    const m = build();
    const found = findAll(m, opts('hello'));
    const sorted = [...found].sort((a, b) => comparePositions(a, b));
    expect(sorted).toEqual(found);
    expect(found.map((f) => f.slideIndex)).toEqual([0, 0, 0, 2, 2, 2]);
    expect(new Set(found.map(matchKey)).size).toBe(found.length);
    m.destroy();
  });

  it('finds across runs of different formatting, and a hard break is one character', () => {
    const d = doc(para(run('Hel', 'bold'), run('lo wor', 'italic'), brk, run('ld')));
    expect(paragraphText(d.content[0]!)).toBe('Hello wor\nld');
    expect(findInDoc(d, pattern(opts('Hello'))!)).toEqual([{ para: 0, start: 0, end: 5 }]);
    expect(findInDoc(d, pattern(opts('wor\nld'))!)).toEqual([{ para: 0, start: 6, end: 12 }]);
  });

  it('does not find across paragraphs', () => {
    expect(findInDoc(doc(para(run('hel')), para(run('lo'))), pattern(opts('hello'))!)).toEqual([]);
  });

  it('follows the deck: a slide changed is searched again, one that did not is not', () => {
    const m = build();
    expect(findAll(m, opts('hello'))).toHaveLength(6);
    expect(findAll(m, opts('hello'))).toHaveLength(6);
    const first = findAll(m, opts('hello'))[0]!;
    replaceOne(m, first, opts('hello'), 'hi');
    const after = findAll(m, opts('hello'));
    expect(after).toHaveLength(5);
    expect(after[0]!.para).toBe(1);
    m.destroy();
  });

  it('says what paragraph a match is in, as it is now', () => {
    const m = build();
    const found = findAll(m, opts('again'))[0]!;
    expect(paragraphOf(m, found)).toBe('and hello again');
    m.destroy();
  });
});

describe('stepping through matches', () => {
  const list = (slides: number[]): Match[] =>
    slides.map((slideIndex, i) => ({ slide: `s${slideIndex}`, slideIndex, body: 0, place: { kind: 'shape', el: 'e' }, para: 0, start: i * 10, end: i * 10 + 1 }));
  const found = list([0, 0, 2, 4]);

  it('goes to the next after a place, and wraps', () => {
    expect(stepMatch(found, positionOf(found[0]!), 1)).toBe(found[1]);
    expect(stepMatch(found, positionOf(found[3]!), 1)).toBe(found[0]);
  });

  it('goes to the previous before a place, and wraps', () => {
    expect(stepMatch(found, positionOf(found[2]!), -1)).toBe(found[1]);
    expect(stepMatch(found, positionOf(found[0]!), -1)).toBe(found[3]);
  });

  it('starts from the slide on screen: forwards takes its own matches, backwards the ones before it', () => {
    expect(stepMatch(found, startOfSlide(2), 1)).toBe(found[2]);
    expect(stepMatch(found, startOfSlide(2), -1)).toBe(found[1]);
    expect(stepMatch(found, startOfSlide(0), -1)).toBe(found[3]);
    expect(stepMatch(found, startOfSlide(5), 1)).toBe(found[0]);
  });

  it('has nowhere to go without matches, and the first or last with no starting place', () => {
    expect(stepMatch([], null, 1)).toBeNull();
    expect(stepMatch(found, null, 1)).toBe(found[0]);
    expect(stepMatch(found, null, -1)).toBe(found[3]);
  });
});

describe('replacing text', () => {
  it('keeps the formatting of the text it stands in for', () => {
    const d = doc(para(run('Say '), run('hello', 'bold'), run(' now', 'italic')));
    const r = replaceInDoc(d, pattern(opts('hello'))!, 'hi');
    expect(r.count).toBe(1);
    expect(r.doc.content[0]!.content).toEqual([run('Say '), run('hi', 'bold'), run(' now', 'italic')]);
  });

  it('across runs, takes the formatting of the first character and leaves what is around it alone', () => {
    const d = doc(para(run('a Hel', 'bold'), run('lo b', 'italic')));
    const r = replaceInDoc(d, pattern(opts('Hello'))!, 'Hi');
    expect(r.doc.content[0]!.content).toEqual([run('a Hi', 'bold'), run(' b', 'italic')]);
  });

  it('joins neighbours that end up alike, and keeps a hard break where it was', () => {
    const d = doc(para(run('one two'), brk, run('two three')));
    const r = replaceInDoc(d, pattern(opts('two'))!, 'ten');
    expect(r.doc.content[0]!.content).toEqual([run('one ten'), brk, run('ten three')]);
    expect(r.count).toBe(2);
  });

  it('replaces several in one paragraph, none of them found again inside a replacement', () => {
    const r = replaceInDoc(doc(para(run('a a a'))), pattern(opts('a'))!, 'aa');
    expect(plainText(r.doc)).toBe('aa aa aa');
    expect(r.count).toBe(3);
  });

  it('takes text away with an empty replacement, and leaves an empty paragraph with no content', () => {
    const r = replaceInDoc(doc(para(run('gone'))), pattern(opts('gone'))!, '');
    expect(r.doc.content[0]).toEqual({ type: 'paragraph' });
  });

  it('does not touch another paragraph, its attributes, or what it was not asked to', () => {
    const d: TextDoc = doc({ type: 'paragraph', attrs: { align: 'center', level: 2 }, content: [run('x hello')] }, para(run('untouched hello')));
    const r = replaceRanges(d, [{ para: 0, start: 2, end: 7 }], 'y');
    expect(r.content[0]).toEqual({ type: 'paragraph', attrs: { align: 'center', level: 2 }, content: [run('x y')] });
    expect(r.content[1]).toBe(d.content[1]);
  });

  it('copes with text outside the basic plane', () => {
    const r = replaceInDoc(doc(para(run('a 😀 b 😀'))), pattern(opts('😀'))!, '🙂');
    expect(plainText(r.doc)).toBe('a 🙂 b 🙂');
  });
});

describe('Replace all', () => {
  const build = () =>
    modelOf(
      testDeck([
        slide('s1', [shape('a', txt('Hello there')), shape('b', txt('hello', 'again'), 200)], txt('Say hello')),
        slide('s2', [shape('c', txt('Goodbye'))]),
        slide('s3', [shape('d', txt('HELLO'))])
      ])
    );

  it('is one step across every slide and the notes, and one undo puts all of it back', () => {
    const m = build();
    const before = texts(m);
    const r = replaceAll(m, opts('hello'), 'hi');
    expect(r).toEqual({ outcome: 'done', count: 4, slides: 2 });
    expect(texts(m)).toEqual(['hi there', 'hi\nagain', 'Say hi', 'Goodbye', 'hi']);
    expect(m.undo()).toBe(true);
    expect(texts(m)).toEqual(before);
    // Nothing is left to undo: it was one entry.
    expect(m.canUndo()).toBe(false);
    expect(m.redo()).toBe(true);
    expect(texts(m)).toEqual(['hi there', 'hi\nagain', 'Say hi', 'Goodbye', 'hi']);
    m.destroy();
  });

  it('leaves the notes alone when they are not searched', () => {
    const m = build();
    replaceAll(m, opts('hello', { notes: false }), 'hi');
    expect(m.slide('s1')!.notes).toBeDefined();
    expect(plainText(m.slide('s1')!.notes)).toBe('Say hello');
    m.destroy();
  });

  it('says so when there is nothing to replace, and writes nothing', () => {
    const m = build();
    expect(replaceAll(m, opts('zebra'), 'x')).toEqual({ outcome: 'nothing', count: 0, slides: 0 });
    expect(replaceAll(m, opts(''), 'x').outcome).toBe('nothing');
    expect(m.canUndo()).toBe(false);
    m.destroy();
  });

  it('is refused for a reader, and nothing changes', () => {
    const m = modelOf(testDeck([slide('s1', [shape('a', txt('hello'))])]), { readOnly: true });
    expect(replaceAll(m, opts('hello'), 'hi').outcome).toBe('read-only');
    expect(texts(m)).toEqual(['hello']);
    m.destroy();
  });

  it('is refused, before it writes anything, when the deck would pass its size limit', () => {
    const m = build();
    vi.spyOn(m, 'bytes').mockReturnValue(LIMITS.docStateMaxBytes);
    const r = replaceAll(m, opts('hello'), 'hi');
    expect(r.outcome).toBe('too-large');
    expect(texts(m)[0]).toBe('Hello there');
    expect(m.canUndo()).toBe(false);
    m.destroy();
  });

  it('works while a text box is typed in elsewhere: only its own text is rewritten', () => {
    const m = build();
    const before = m.textFragment('s2', 'c')!.toJSON();
    replaceAll(m, opts('hello'), 'hi');
    expect(m.textFragment('s2', 'c')!.toJSON()).toBe(before);
    m.destroy();
  });
});

describe('Replace', () => {
  it('changes only the match it is given', () => {
    const m = modelOf(testDeck([slide('s1', [shape('a', txt('hello hello'))])]));
    const found = findAll(m, opts('hello'));
    expect(replaceOne(m, found[1]!, opts('hello'), 'hi')).toEqual({ outcome: 'done', count: 1, slides: 1 });
    expect(texts(m)).toEqual(['hello hi']);
    expect(m.undo()).toBe(true);
    expect(texts(m)).toEqual(['hello hello']);
    m.destroy();
  });

  it('does nothing when the text has moved on since the match was found', () => {
    const m = modelOf(testDeck([slide('s1', [shape('a', txt('hello'))])]));
    const found = findAll(m, opts('hello'))[0]!;
    replaceOne(m, found, opts('hello'), 'goodbye');
    // The same match again: that text is gone.
    expect(replaceOne(m, found, opts('hello'), 'x').outcome).toBe('nothing');
    expect(texts(m)).toEqual(['goodbye']);
    m.destroy();
  });
});

describe('the notice after a replace', () => {
  it('says how many, and on how many slides', () => {
    expect(replacedText({ outcome: 'done', count: 1, slides: 1 })).toBe('Replaced 1 match.');
    expect(replacedText({ outcome: 'done', count: 4, slides: 1 })).toBe('Replaced 4 matches.');
    expect(replacedText({ outcome: 'done', count: 1200, slides: 30 })).toBe('Replaced 1,200 matches on 30 slides.');
    expect(replacedText({ outcome: 'nothing', count: 0, slides: 0 })).toBe('Nothing to replace.');
    expect(replacedText({ outcome: 'read-only', count: 0, slides: 0 })).toBe('You can view this presentation, not edit it.');
  });
});
