import { describe, expect, it } from 'vitest';
import { pasteFrom, writeClipboard, type ClipMark } from './clipboard';
import { FakeSheet } from './testing/fake';
import type { Rect } from './types';

/** The two methods of DataTransfer the grid uses, over a map. */
function transfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    data
  };
}

const rect: Rect = { r1: 0, r2: 1, c1: 0, c2: 1 };

function sheet() {
  const s = new FakeSheet({ rows: 10, cols: 5 });
  s.put(0, 0, 'a').put(0, 1, '1').put(1, 0, 'b').put(1, 1, '2');
  return s;
}

describe('copy', () => {
  it('puts text and an HTML table on the clipboard, as the model made them', () => {
    const t = transfer();
    const mark = writeClipboard(t as unknown as DataTransfer, sheet(), rect, false);
    expect(t.getData('text/plain')).toBe('a\t1\nb\t2');
    expect(t.getData('text/html')).toContain('<table>');
    expect(t.getData('text/html')).toContain('<td>b</td>');
    expect(mark).toEqual({ rect, cut: false, text: 'a\t1\nb\t2' });
  });

  it('remembers a cut, and removes nothing', () => {
    const s = sheet();
    const mark = writeClipboard(transfer() as unknown as DataTransfer, s, rect, true);
    expect(mark.cut).toBe(true);
    expect(s.intents).toEqual([]);
    expect(s.editText(0, 0)).toBe('a');
  });
});

describe('paste', () => {
  const at = { row: 5, col: 2 };

  it('sends the text and the HTML, untouched, with where it goes', () => {
    const t = transfer({ 'text/plain': 'x\ty\nz\tw', 'text/html': '<table><tr><td>x</td></tr></table>' });
    expect(pasteFrom(t, at, null)).toEqual({ type: 'paste', at, text: 'x\ty\nz\tw', html: '<table><tr><td>x</td></tr></table>' });
  });

  it('is text alone when there is no HTML (a terminal, a plain editor)', () => {
    expect(pasteFrom(transfer({ 'text/plain': 'hello' }), at, null)).toEqual({ type: 'paste', at, text: 'hello' });
  });

  it('is HTML alone when there is no text', () => {
    const intent = pasteFrom(transfer({ 'text/html': '<b>hi</b>' }), at, null);
    expect(intent).toEqual({ type: 'paste', at, text: '', html: '<b>hi</b>' });
  });

  it('is nothing for an empty clipboard', () => {
    expect(pasteFrom(transfer(), at, null)).toBeNull();
  });

  it('says where a cut came from, when the clipboard still holds that cut', () => {
    const mark: ClipMark = { rect, cut: true, text: 'a\t1\nb\t2' };
    const t = transfer({ 'text/plain': 'a\t1\nb\t2' });
    expect(pasteFrom(t, at, mark)).toEqual({ type: 'paste', at, text: 'a\t1\nb\t2', cut: rect });
  });

  it('knows a Windows clipboard\'s line endings are the same text', () => {
    const mark: ClipMark = { rect, cut: true, text: 'a\t1\nb\t2' };
    expect(pasteFrom(transfer({ 'text/plain': 'a\t1\r\nb\t2' }), at, mark)).toMatchObject({ cut: rect });
  });

  it('is an ordinary paste when something else has been copied since the cut, or the mark was a copy', () => {
    const cut: ClipMark = { rect, cut: true, text: 'a\t1\nb\t2' };
    expect(pasteFrom(transfer({ 'text/plain': 'something else' }), at, cut)).not.toHaveProperty('cut');
    const copy: ClipMark = { rect, cut: false, text: 'a\t1\nb\t2' };
    expect(pasteFrom(transfer({ 'text/plain': 'a\t1\nb\t2' }), at, copy)).not.toHaveProperty('cut');
  });

  it('round trips through a fake model: cut, paste elsewhere, the source is gone', () => {
    const s = sheet();
    const mark = writeClipboard(transfer() as unknown as DataTransfer, s, rect, true);
    const t = transfer({ 'text/plain': mark.text });
    s.apply(pasteFrom(t, { row: 4, col: 3 }, mark)!);
    expect(s.rowsOf({ r1: 4, r2: 5, c1: 3, c2: 4 })).toEqual([['a', '1'], ['b', '2']]);
    expect(s.editText(0, 0)).toBe('');
  });
});
