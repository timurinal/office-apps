import { describe, expect, it } from 'vitest';
import type { LayoutJSON, MasterJSON } from '../model/deck';
import { LINE_FACTOR as MODEL_LINE_FACTOR } from '../model/schema';
import { LINE_FACTOR, resolveStyle } from './styles';

const master: MasterJSON = {
  elements: [],
  styles: {
    title: { fontSize: 40, bold: true },
    body: [{ fontSize: 24 }, { fontSize: 22 }, { fontSize: 20 }],
    other: { fontSize: 18 }
  }
};
const layout: LayoutJSON = { id: 'x', name: 'X', elements: [], styles: { subTitle: [{ fontSize: 80, bold: true }, { fontSize: 22 }], body: [{ fontSize: 28 }] } };

describe('resolveStyle', () => {
  it('takes the master’s style by kind and level', () => {
    expect(resolveStyle(master, undefined, 'title', 0)).toEqual({ fontSize: 40, bold: true });
    expect(resolveStyle(master, undefined, 'ctrTitle', 0)).toEqual({ fontSize: 40, bold: true });
    expect(resolveStyle(master, undefined, 'body', 1)).toEqual({ fontSize: 22 });
    expect(resolveStyle(master, undefined, undefined, 0)).toEqual({ fontSize: 18 });
    expect(resolveStyle(master, undefined, 'dt', 0)).toEqual({ fontSize: 18 });
  });

  it('lays the layout’s style for that type and level over it', () => {
    expect(resolveStyle(master, layout, 'subTitle', 0)).toEqual({ fontSize: 80, bold: true });
    expect(resolveStyle(master, layout, 'subTitle', 1)).toEqual({ fontSize: 22 });
    expect(resolveStyle(master, layout, 'body', 0)).toEqual({ fontSize: 28 });
  });

  it('leaves a level the layout does not name to the master', () => {
    expect(resolveStyle(master, layout, 'body', 1)).toEqual({ fontSize: 22 });
  });

  it('holds a deep level at the last the master has', () => {
    expect(resolveStyle(master, undefined, 'body', 8)).toEqual({ fontSize: 20 });
  });
});

describe('LINE_FACTOR', () => {
  it('is the model’s, so a line height here means what the editor draws', () => {
    expect(LINE_FACTOR).toBe(MODEL_LINE_FACTOR);
  });
});
