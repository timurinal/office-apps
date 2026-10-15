import { describe, expect, it } from 'vitest';
import type { TextDoc } from '../model/deck';
import { noteLines } from './notes';

const para = (text: string, attrs?: Record<string, unknown>, marks?: { type: string }[]) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {})
});
const doc = (...content: ReturnType<typeof para>[]): TextDoc => ({ type: 'doc', content });

describe('speaker notes in the presenter’s window', () => {
  it('has no lines for no notes', () => {
    expect(noteLines(undefined)).toEqual([]);
    expect(noteLines(null)).toEqual([]);
    expect(noteLines(doc())).toEqual([]);
  });

  it('is one line per paragraph, with its emphasis', () => {
    const lines = noteLines(doc(para('Open with the number.', undefined, [{ type: 'bold' }, { type: 'italic' }]), para('Then pause.')));
    expect(lines).toEqual([
      { runs: [{ text: 'Open with the number.', bold: true, italic: true }], bullet: null, level: 0 },
      { runs: [{ text: 'Then pause.' }], bullet: null, level: 0 }
    ]);
  });

  it('keeps a blank line between paragraphs and drops the blank lines at the end', () => {
    const lines = noteLines(doc(para('One.'), para(''), para('Two.'), para(''), para('')));
    expect(lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['One.', '', 'Two.']);
  });

  it('turns a hard break into a newline in the same line', () => {
    const lines = noteLines({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.runs.map((r) => r.text)).toEqual(['a', '\n', 'b']);
  });

  it('draws the bullets a paragraph states, and counts a numbered list through its items', () => {
    const lines = noteLines(
      doc(
        para('Pause.', { bullet: { kind: 'char', char: '•' } }),
        para('First.', { bullet: { kind: 'number', style: 'arabicPeriod' } }),
        para('Second.', { bullet: { kind: 'number', style: 'arabicPeriod' } }),
        para('Plain.'),
        para('Again.', { bullet: { kind: 'number', style: 'arabicPeriod' } })
      )
    );
    expect(lines.map((l) => l.bullet)).toEqual(['•', '1.', '2.', null, '1.']);
  });

  it('keeps a level, inside the range', () => {
    expect(noteLines(doc(para('Deep.', { level: 3 })))[0]!.level).toBe(3);
    expect(noteLines(doc(para('Deeper.', { level: 40 })))[0]!.level).toBe(8);
    expect(noteLines(doc(para('Odd.', { level: 'x' })))[0]!.level).toBe(0);
  });

  it('reads only text, so nothing in a notes body can become markup', () => {
    const lines = noteLines({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] });
    expect(lines[0]!.runs).toEqual([{ text: '<img src=x onerror=alert(1)>' }]);
  });
});
