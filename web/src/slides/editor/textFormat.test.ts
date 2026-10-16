import { describe, expect, it } from 'vitest';
import type { TextDoc } from '../model/deck';
import { txt } from '../model/testing';
import { anyStyle, bulletToggle, hasMark, NUMBER_ON, setMark, setParagraphs, setStyle, shiftLevels, styleOf } from './textFormat';

const runs = (doc: TextDoc) => doc.content.flatMap((p) => p.content ?? []);

describe('whole-text formatting', () => {
  it('a mark goes on every run, and sup and sub exclude each other', () => {
    let doc = setMark(txt('a', 'b'), 'bold', true);
    expect(hasMark(doc, 'bold')).toBe(true);
    doc = setMark(doc, 'sup', true);
    doc = setMark(doc, 'sub', true);
    expect(runs(doc)[0]!.marks!.map((m) => m.type)).toEqual(['bold', 'sub']);
    expect(hasMark(setMark(doc, 'bold', false), 'bold')).toBe(false);
  });

  it('an empty box has no mark', () => {
    expect(hasMark(txt(''), 'bold')).toBe(false);
  });

  it('style merges into the runs, and null takes it away', () => {
    let doc = setStyle(txt('a'), { fontSize: 24, color: '#ff0000' });
    doc = setStyle(doc, { fontSize: null, fontFamily: 'Georgia' });
    expect(runs(doc)[0]!.marks).toEqual([{ type: 'textStyle', attrs: { color: '#ff0000', fontFamily: 'Georgia' } }]);
    doc = setStyle(doc, { color: null, fontFamily: null });
    expect(runs(doc)[0]!.marks).toBeUndefined();
  });

  it('a value is the same on every run or null', () => {
    const one = setStyle(txt('a'), { fontSize: 20 });
    const two: TextDoc = { type: 'doc', content: [...one.content, ...txt('b').content] };
    expect(styleOf(one, 'fontSize')).toBe(20);
    expect(styleOf(two, 'fontSize')).toBeNull();
    expect(anyStyle(two, 'fontSize')).toBe(true);
    expect(anyStyle(txt('b'), 'fontSize')).toBe(false);
  });

  it('paragraph attributes are laid over, and null removes one', () => {
    let doc = setParagraphs(txt('a', 'b'), { align: 'center', lineHeight: 1.5 });
    expect(doc.content.map((p) => p.attrs)).toEqual([{ align: 'center', lineHeight: 1.5 }, { align: 'center', lineHeight: 1.5 }]);
    doc = setParagraphs(doc, { align: null, lineHeight: null });
    expect(doc.content.map((p) => p.attrs)).toEqual([undefined, undefined]);
  });

  it('levels stay between 0 and 8, and 0 is no attribute', () => {
    let doc = shiftLevels(txt('a'), -1);
    expect(doc.content[0]!.attrs).toBeUndefined();
    for (let i = 0; i < 10; i++) doc = shiftLevels(doc, 1);
    expect(doc.content[0]!.attrs).toEqual({ level: 8 });
  });

  it('bullets toggle off when all have them, back to the inherited kind, or on', () => {
    expect(bulletToggle('char', 'char', 'char')).toEqual({ bullet: { kind: 'none' } });
    expect(bulletToggle('char', 'none', 'char')).toEqual({ bullet: null });
    expect(bulletToggle('number', 'char', 'char')).toEqual({ bullet: NUMBER_ON });
  });
});
