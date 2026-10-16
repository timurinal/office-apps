// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterFrames, domPoint, domText, paragraphsIn, selectInEditor } from './findDom';

let pm: HTMLElement;
beforeEach(() => {
  pm = document.createElement('div');
  pm.className = 'sl-pm';
  pm.setAttribute('contenteditable', 'true');
  // What the editor draws: a bullet that is not text, bold and italic runs, a hard break, a second paragraph and an empty one.
  pm.innerHTML =
    '<p><span class="sl-bullet" contenteditable="false">•</span>Hel<strong>lo</strong> wor<br>ld</p>' +
    '<p>Second <em>one</em></p>' +
    '<p><br class="ProseMirror-trailingBreak"></p>';
  document.body.appendChild(pm);
});
afterEach(() => {
  pm.remove();
  document.getSelection()?.removeAllRanges();
});

describe('reading the editor back', () => {
  it('finds the paragraphs and reads them as the search counts: no bullet, a break as one character', () => {
    const ps = paragraphsIn(pm);
    expect(ps).toHaveLength(3);
    expect(domText(ps[0]!)).toBe('Hello wor\nld');
    expect(domText(ps[1]!)).toBe('Second one');
    expect(domText(ps[2]!)).toBe('');
  });

  it('puts a start in the run of the character after it and an end in the run of the one before it', () => {
    const p = paragraphsIn(pm)[0]!;
    const start = domPoint(p, 3, 'start')!;
    expect([start.node.textContent, start.offset]).toEqual(['lo', 0]);
    const end = domPoint(p, 3, 'end')!;
    expect([end.node.textContent, end.offset]).toEqual(['Hel', 3]);
    // Past a break: one character is the break.
    const after = domPoint(p, 10, 'start')!;
    expect([after.node.textContent, after.offset]).toEqual(['ld', 0]);
    const last = domPoint(p, 12, 'end')!;
    expect([last.node.textContent, last.offset]).toEqual(['ld', 2]);
  });
});

describe('selecting a match', () => {
  it('selects the range across runs and gives the editor the keyboard', () => {
    const focus = vi.spyOn(pm, 'focus');
    expect(selectInEditor(pm, 0, 2, 7, 'Hello wor\nld')).toBe(true);
    expect(focus).toHaveBeenCalled();
    const range = document.getSelection()!.getRangeAt(0);
    expect([range.startContainer.textContent, range.startOffset]).toEqual(['Hel', 2]);
    expect([range.endContainer.textContent, range.endOffset]).toEqual([' wor', 2]);
  });

  it('selects in the second paragraph too', () => {
    expect(selectInEditor(pm, 1, 7, 10, 'Second one')).toBe(true);
    const range = document.getSelection()!.getRangeAt(0);
    expect([range.startContainer.textContent, range.startOffset]).toEqual(['one', 0]);
    expect([range.endContainer.textContent, range.endOffset]).toEqual(['one', 3]);
  });

  it('selects nothing when the editor shows another paragraph than the one searched', () => {
    expect(selectInEditor(pm, 0, 0, 5, 'Something else')).toBe(false);
    expect(selectInEditor(pm, 9, 0, 1, 'x')).toBe(false);
    expect(document.getSelection()!.rangeCount).toBe(0);
  });
});

describe('waiting for the editor', () => {
  it('tries on each frame until it is done, and stops after that', async () => {
    const calls: number[] = [];
    afterFrames(() => {
      calls.push(calls.length);
      return calls.length === 3;
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toEqual([0, 1, 2]);
  });

  it('gives up after the frames it was given, and can be cancelled', async () => {
    let n = 0;
    afterFrames(() => {
      n += 1;
      return false;
    }, 2);
    await new Promise((r) => setTimeout(r, 120));
    expect(n).toBe(2);
    let m = 0;
    const cancel = afterFrames(() => {
      m += 1;
      return false;
    });
    cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(m).toBe(0);
  });
});
