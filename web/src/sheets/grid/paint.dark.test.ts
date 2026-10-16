// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { darkFill, darkInk } from '../../core/darkColors';
import { Axis, GridLayout } from './geometry';
import { MergeIndex } from './merges';
import { Painter, type PaintState } from './paint';
import { FakeSheet } from './testing/fake';
import { FALLBACK_THEME, type GridTheme } from './theme';

/**
 * A canvas that writes down what it was asked to draw: every `fillRect` and `fillText` with the
 * `fillStyle` that was current. The painter's colours are the whole question here, so nothing is
 * measured in pixels.
 */
function recorder() {
  const drawn: { op: 'rect' | 'text'; style: string; text?: string }[] = [];
  let fillStyle = '';
  const base: Record<string, unknown> = {
    canvas: { width: 700, height: 500 },
    measureText: (t: string) => ({ width: t.length * 6 }),
    font: '',
    fillRect: () => drawn.push({ op: 'rect', style: fillStyle }),
    fillText: (t: string) => drawn.push({ op: 'text', style: fillStyle, text: t })
  };
  const ctx = new Proxy(base, {
    get: (o, k: string) => (k in o ? o[k] : () => undefined),
    set: (o, k: string, v) => {
      if (k === 'fillStyle') fillStyle = String(v);
      else o[k] = v;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn };
}

function state(sheet: FakeSheet, theme: GridTheme): PaintState {
  const L = new GridLayout({
    rows: Axis.build(12, () => 26, 1),
    cols: Axis.build(5, () => 100, 1),
    zoom: 1,
    frozenRows: 0,
    frozenCols: 0,
    viewW: 600,
    viewH: 400,
    headerW: 46,
    headerH: 26,
    offsetX: 0,
    offsetY: 0
  });
  return { data: sheet, version: sheet.version, layout: L, merges: new MergeIndex([]), theme, dpr: 1, sel: null, wholeRows: false, wholeCols: false, filter: null };
}

const DARK: GridTheme = { ...FALLBACK_THEME, paper: '#232532', ink: '#e9e9ed' };

function sheet() {
  const s = new FakeSheet({ rows: 12, cols: 5 });
  s.put(0, 0, 'plain');
  s.put(1, 0, 'red', { color: '#c0392b' });
  s.put(2, 0, 'filled', { fill: '#fff2a8', color: '#000000' });
  s.put(3, 0, 'fill only', { fill: '#e7f5ee' });
  return s;
}

const draw = (theme: GridTheme) => {
  const { ctx, drawn } = recorder();
  new Painter(ctx).paint(state(sheet(), theme));
  return drawn;
};
const textStyle = (drawn: ReturnType<typeof draw>, text: string) => drawn.find((d) => d.op === 'text' && d.text === text)?.style;
const rects = (drawn: ReturnType<typeof draw>) => new Set(drawn.filter((d) => d.op === 'rect').map((d) => d.style));

describe('the colours a sheet draws with', () => {
  it('keeps the fills and text colours a person set, and the automatic text is the theme’s', () => {
    const d = draw(DARK);
    expect(textStyle(d, 'plain')).toBe('#e9e9ed');
    expect(textStyle(d, 'red')).toBe('#c0392b');
    expect(textStyle(d, 'filled')).toBe('#000000');
    expect(rects(d).has('#fff2a8')).toBe(true);
    expect(rects(d).has('#e7f5ee')).toBe(true);
  });

  it('with Dark cells on, maps them: hue kept, lightness inverted, text and fill held to 4.5:1', () => {
    const d = draw({ ...DARK, darkCells: true });
    expect(textStyle(d, 'plain')).toBe('#e9e9ed');
    expect(textStyle(d, 'red')).toBe(darkInk('#c0392b'));
    expect(textStyle(d, 'filled')).toBe(darkInk('#000000'));
    expect(rects(d).has(darkFill('#fff2a8'))).toBe(true);
    expect(rects(d).has(darkFill('#e7f5ee'))).toBe(true);
    expect(rects(d).has('#fff2a8')).toBe(false);
    expect(rects(d).has('#e7f5ee')).toBe(false);
  });

  it('draws the same with Dark cells off as before there was such a thing', () => {
    expect(draw({ ...DARK, darkCells: false })).toEqual(draw(DARK));
  });

  it('is unchanged in the light theme, which does not set the option', () => {
    const light = draw(FALLBACK_THEME);
    expect(textStyle(light, 'red')).toBe('#c0392b');
    expect(rects(light).has('#fff2a8')).toBe(true);
  });
});
