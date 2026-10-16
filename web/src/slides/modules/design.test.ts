import { describe, expect, it } from 'vitest';
import { box, LAYOUTS, modelOf, testDeck, txt } from '../model/testing';
import type { ElementJSON, ShapeElement } from '../model/deck';
import { THEMES, layoutsFor, themeById } from '../themes';
import { applyTheme } from './design';

const ph = (id: string, type: 'ctrTitle' | 'subTitle', x: number, y: number, w: number, h: number): ShapeElement => ({
  ...box(x, y, w, h),
  id,
  ph: { type },
  text: txt('kept')
});

/** The real layout's placeholder of a type, for a theme. */
const real = (themeId: string, layout: string, type: 'ctrTitle' | 'subTitle') => {
  const l = layoutsFor(themeById(themeId)!).find((x) => x.id === layout)!;
  return l.elements.find((e) => e.ph?.type === type)!;
};

/** A deck whose title layout puts its placeholders somewhere the real themes' do not (40, 60 and 40, 400). */
function titleSlide(elements: ElementJSON[]) {
  const old = testDeck([{ id: 's1', layout: 'title', elements }]);
  old.layouts = [
    { id: 'title', name: 'Title slide', elements: [ph('lt', 'ctrTitle', 40, 60, 900, 300), ph('ls', 'subTitle', 40, 400, 900, 120)] },
    ...LAYOUTS.filter((l) => l.id !== 'title')
  ];
  return modelOf(old);
}

describe('applying a theme', () => {
  it('writes the theme, its master and its layouts as one step, and undo brings them all back', () => {
    const m = titleSlide([ph('t', 'ctrTitle', 40, 60, 900, 300)]);
    const before = m.design();
    expect(applyTheme(m, 'midnight')).toBe(true);
    const after = m.design();
    expect(after.theme.id).toBe('midnight');
    expect(after.layouts).toEqual(layoutsFor(themeById('midnight')!));
    expect(after.master.styles.title.fontFamily).toBe('Inter');
    expect(m.undo()).toBe(true);
    expect(m.design()).toEqual(before);
    expect(m.canUndo()).toBe(false);
  });

  it('moves a placeholder that sits where its layout put it to where the new layout puts it, and keeps its text', () => {
    const m = titleSlide([ph('t', 'ctrTitle', 40, 60, 900, 300)]);
    const target = real('midnight', 'title', 'ctrTitle');
    expect([target.x, target.y]).not.toEqual([40, 60]);
    applyTheme(m, 'midnight');
    expect(m.element('s1', 't')).toMatchObject({ x: target.x, y: target.y, w: target.w, h: target.h });
    expect((m.element('s1', 't') as ShapeElement).text).toEqual(txt('kept'));
    expect(m.slide('s1')!.layout).toBe('title');
  });

  it('leaves a placeholder a person moved where they put it', () => {
    const m = titleSlide([ph('t', 'ctrTitle', 40, 60, 900, 300), ph('s', 'subTitle', 50, 60, 700, 120)]);
    applyTheme(m, 'paper');
    expect(m.element('s1', 's')).toMatchObject({ x: 50, y: 60, w: 700, h: 120 });
    const moved = real('paper', 'title', 'ctrTitle');
    expect(m.element('s1', 't')).toMatchObject({ x: moved.x, y: moved.y });
  });

  it('gives a slide whose layout the theme does not have the first of its own, and does not lose the slide', () => {
    const m = modelOf(testDeck([{ id: 's1', layout: 'twoContent', elements: [] }, { id: 's2', layout: 'gone', elements: [] }]));
    applyTheme(m, 'fern');
    expect(m.slide('s1')!.layout).toBe('twoContent');
    expect(layoutsFor(themeById('fern')!).some((l) => l.id === m.slide('s2')!.layout)).toBe(true);
    expect(m.order()).toEqual(['s1', 's2']);
  });

  it('is nothing when it is the theme already, or one that does not exist, and refused for a reader', () => {
    const m = titleSlide([]);
    applyTheme(m, 'ember');
    expect(applyTheme(m, 'ember')).toBe(false);
    expect(applyTheme(m, 'no-such-theme')).toBe(false);
    const reader = modelOf(testDeck(), { readOnly: true });
    const said: string[] = [];
    reader.onNotice((n) => said.push(n.message));
    expect(applyTheme(reader, 'midnight')).toBe(false);
    expect(said).toHaveLength(1);
    expect(reader.design().theme.id).toBe('test');
  });

  it('every theme in the gallery can be applied to a deck made from any other', () => {
    const m = titleSlide([ph('t', 'ctrTitle', 40, 60, 900, 300)]);
    for (const theme of THEMES) {
      m.undoManager.clear();
      applyTheme(m, theme.id);
      expect(m.design().theme.id).toBe(theme.id);
      expect(m.element('s1', 't')).toBeTruthy();
    }
  });
});
