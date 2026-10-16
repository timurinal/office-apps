// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureText, parseColor } from './measure';

describe('colours the browser reports', () => {
  it('reads rgb, rgba, color(srgb), hex and transparent', () => {
    expect(parseColor('rgb(255, 0, 128)')).toEqual({ hex: '#ff0080', alpha: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ hex: '#000000', alpha: 0.5 });
    expect(parseColor('rgb(10 20 30 / 25%)')).toEqual({ hex: '#0a141e', alpha: 0.25 });
    expect(parseColor('color(srgb 1 0.5 0)')).toEqual({ hex: '#ff8000', alpha: 1 });
    expect(parseColor('#abc')).toEqual({ hex: '#aabbcc', alpha: 1 });
    expect(parseColor('#11223380')).toMatchObject({ hex: '#112233' });
    expect(parseColor('#11223380')!.alpha).toBeCloseTo(0.5, 1);
    expect(parseColor('transparent')).toEqual({ hex: '#000000', alpha: 0 });
    expect(parseColor('rgba(0, 0, 0, 0)')!.alpha).toBe(0);
    expect(parseColor('oklch(0.5 0.1 20)')).toBeNull();
  });
});

/**
 * What the browser would say about each character, for a text body that happens to have a layout. The
 * test gives every text node its own: lines of `per` characters, each `w` wide, `lineH` tall, from `left`, `top`.
 */
interface Model {
  per: number;
  w: number;
  lineH: number;
  left: number;
  top: number;
  /** Characters that take no room. */
  none?: string;
}

function fakeRanges(models: Map<Node, Model>) {
  let node: Text | null = null;
  let from = 0;
  let to = 0;
  vi.spyOn(document, 'createRange').mockImplementation(
    () =>
      ({
        setStart: (n: Text, o: number) => void ((node = n), (from = o)),
        setEnd: (_n: Text, o: number) => void (to = o),
        getClientRects: () => {
          const m = models.get(node!)!;
          const ch = node!.data.slice(from, to);
          if (m.none?.includes(ch)) return [];
          const line = Math.floor(from / m.per);
          const left = m.left + (from % m.per) * m.w;
          const top = m.top + line * m.lineH;
          return [{ left, right: left + m.w, top, bottom: top + 40, width: m.w, height: 40, x: left, y: top }];
        }
      }) as unknown as Range
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function frame(html: string): HTMLElement {
  document.body.innerHTML = `<div class="sl-el"><div class="sl-frame"><div class="sl-text">${html}</div></div></div>`;
  return document.querySelector('.sl-frame') as HTMLElement;
}
const texts = (root: Element): Text[] => {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
};

describe('where the lines went', () => {
  it('cuts a text node into a segment for each line the browser broke it onto, at the positions it was drawn', () => {
    const f = frame('<p class="sl-p"><span style="font-size: 36px; font-weight: 700; color: #ff0000">Hello wor</span></p>');
    fakeRanges(new Map([[texts(f)[0]!, { per: 6, w: 10, lineH: 50, left: 120, top: 300 }]]));
    const out = measureText(f, { x: 100, y: 280 });
    expect(out.map((s) => s.text)).toEqual(['Hello', 'wor']);
    // The trailing space the first line broke at is not part of it.
    expect(out[0]).toMatchObject({ x: 20, size: 36, weight: 700, fill: '#ff0000', style: 'normal', primary: expect.any(String) });
    expect(out[1]!.x).toBe(20);
    expect(out[1]!.box.y - out[0]!.box.y).toBe(50);
  });

  it('puts the baseline inside the text’s box by the font’s own ratio, and the box in the element’s frame', () => {
    const f = frame('<p class="sl-p"><span style="font-size: 20px">Hi</span></p>');
    fakeRanges(new Map([[texts(f)[0]!, { per: 9, w: 10, lineH: 50, left: 120, top: 300 }]]));
    const [s] = measureText(f, { x: 100, y: 280 });
    expect(s!.box).toEqual({ x: 20, y: 20, w: 20, h: 40 });
    // No canvas to ask in the test: 0.8 of the box above the baseline.
    expect(s!.y).toBeCloseTo(20 + 40 * 0.8, 5);
  });

  it('keeps runs of one line apart, each with its own look, and paragraphs apart', () => {
    const f = frame('<p class="sl-p"><span style="font-weight: 400">Quarterly </span><span style="font-style: italic; text-decoration-line: underline; background-color: rgb(255, 255, 0)">review</span></p><p class="sl-p"><span>Next</span></p>');
    const [a, b, c] = texts(f);
    fakeRanges(
      new Map([
        [a!, { per: 99, w: 10, lineH: 50, left: 100, top: 10 }],
        [b!, { per: 99, w: 10, lineH: 50, left: 210, top: 10 }],
        [c!, { per: 99, w: 10, lineH: 50, left: 100, top: 90 }]
      ])
    );
    const out = measureText(f, { x: 0, y: 0 });
    expect(out.map((s) => [s.text, s.block, s.x])).toEqual([['Quarterly ', 0, 100], ['review', 0, 210], ['Next', 1, 100]]);
    expect(out[1]).toMatchObject({ style: 'italic', decoration: 'underline', highlight: { fill: '#ffff00', opacity: 1 } });
    expect(out[0]!.highlight).toBeNull();
    expect(out[0]!.decoration).toBe('');
  });

  it('leaves a mark that takes no room with the character before it', () => {
    const f = frame('<p class="sl-p"><span>éx</span></p>');
    fakeRanges(new Map([[texts(f)[0]!, { per: 9, w: 10, lineH: 50, left: 0, top: 0, none: '́' }]]));
    expect(measureText(f, { x: 0, y: 0 }).map((s) => s.text)).toEqual(['éx']);
  });

  it('counts a character outside the first plane as one', () => {
    const f = frame('<p class="sl-p"><span>a★😀b</span></p>');
    fakeRanges(new Map([[texts(f)[0]!, { per: 99, w: 10, lineH: 50, left: 0, top: 0 }]]));
    expect(measureText(f, { x: 0, y: 0 }).map((s) => s.text)).toEqual(['a★😀b']);
  });

  it('says nothing for a body with no text', () => {
    const f = frame('<p class="sl-p"><br></p>');
    expect(measureText(f, { x: 0, y: 0 })).toEqual([]);
  });
});
