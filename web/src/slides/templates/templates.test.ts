import { describe, expect, it } from 'vitest';
import { PREDEFINED_PREFIX as DOCS_PREFIX } from '../../docs/templates';
import { DECK_LIMITS, SLIDE_HEIGHT, SLIDE_WIDTH, type DeckJSON, type ElementJSON, type TextDoc, type TextNode } from '../model/deck';
import { plainText } from '../themes/build';
import { contrast, resolveColor } from '../themes/color';
import { FOOTER_TYPES, layoutsFor, masterFor, SLIDE_NUMBER_TEXT, THEMES } from '../themes';
import {
  findSlidesTemplate,
  predefinedSlidesId,
  predefinedSlidesSummaries,
  PREDEFINED_PREFIX,
  SLIDES_TEMPLATES
} from './index';

const H = SLIDE_HEIGHT['16:9'];

/** Every element on a slide, groups opened. */
const flat = (els: ElementJSON[]): ElementJSON[] => els.flatMap((e) => (e.type === 'group' ? [e, ...flat(e.children)] : [e]));

const PARAGRAPH_ATTRS = new Set(['align', 'level', 'bullet', 'spaceBefore', 'spaceAfter', 'lineHeight']);
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'highlight', 'sup', 'sub']);

function checkText(doc: TextDoc, at: string): void {
  expect(doc.type, at).toBe('doc');
  expect(doc.content.length, at).toBeGreaterThan(0);
  for (const p of doc.content) {
    expect(p.type, at).toBe('paragraph');
    for (const key of Object.keys(p.attrs ?? {})) expect(PARAGRAPH_ATTRS.has(key), `${at}: paragraph attr ${key}`).toBe(true);
    const level = p.attrs?.level;
    if (level !== undefined) {
      expect(level, at).toBeGreaterThanOrEqual(0);
      expect(level, at).toBeLessThanOrEqual(8);
    }
    for (const run of (p.content ?? []) as TextNode[]) {
      expect(run.type, at).toBe('text');
      // A text node may not be empty.
      expect(run.text?.length ?? 0, at).toBeGreaterThan(0);
      for (const mark of run.marks ?? []) expect(MARKS.has(mark.type), `${at}: mark ${mark.type}`).toBe(true);
    }
  }
}

const noUndefined = (v: unknown, path: string): void => {
  if (v === undefined) throw new Error(`undefined at ${path}`);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) noUndefined(x, `${path}.${k}`);
};

describe('the predefined Slides templates', () => {
  it('are six, each with a slug, a title and a description that cannot be mistaken for another', () => {
    expect(SLIDES_TEMPLATES).toHaveLength(6);
    for (const t of SLIDES_TEMPLATES) {
      expect(t.slug, t.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.title.length).toBeLessThanOrEqual(40);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.description).toMatch(/\.$/);
      // `templateId` is at most 200 characters in the create call.
      expect(predefinedSlidesId(t).length).toBeLessThan(200);
    }
    for (const key of ['slug', 'title', 'description'] as const) {
      expect(new Set(SLIDES_TEMPLATES.map((t) => t[key])).size, key).toBe(SLIDES_TEMPLATES.length);
    }
  });

  it('are a project kick-off, a pitch, a weekly update, a lesson, a quarterly report and a workshop agenda', () => {
    expect(SLIDES_TEMPLATES.map((t) => t.slug)).toEqual(['kickoff', 'pitch', 'weekly-update', 'lesson', 'quarterly-report', 'workshop']);
  });

  it('use the same id scheme as Docs’ templates, and are found by it', () => {
    expect(PREDEFINED_PREFIX).toBe(DOCS_PREFIX);
    for (const t of SLIDES_TEMPLATES) expect(findSlidesTemplate(`${PREDEFINED_PREFIX}${t.slug}`)).toBe(t);
    expect(findSlidesTemplate('predefined:nope')).toBeUndefined();
    expect(findSlidesTemplate('kickoff')).toBeUndefined();
  });

  it('are listed in the shelf’s own shape, as predefined and for Slides', () => {
    const list = predefinedSlidesSummaries();
    expect(list.map((t) => t.id)).toEqual(SLIDES_TEMPLATES.map(predefinedSlidesId));
    for (const t of list) expect(t).toMatchObject({ kind: 'slides', scope: 'predefined', ownerName: null });
    // Home names them from summaries.ts without loading the decks: the names must be the decks' own.
    expect(list.map((t) => [t.title, t.description])).toEqual(SLIDES_TEMPLATES.map((t) => [t.title, t.description]));
  });

  it('draw their cover from a slide they have', () => {
    for (const t of SLIDES_TEMPLATES) {
      const deck = t.deck();
      expect(t.cover ?? 0, t.slug).toBeGreaterThanOrEqual(0);
      expect(t.cover ?? 0, t.slug).toBeLessThan(deck.slides.length);
    }
  });

  it('each use a theme of their own, and the first is Violet', () => {
    const used = SLIDES_TEMPLATES.map((t) => t.deck().theme.id);
    expect(new Set(used).size).toBe(used.length);
    expect(used[0]).toBe('violet');
    for (const id of used) expect(THEMES.some((t) => t.id === id)).toBe(true);
  });

  for (const t of SLIDES_TEMPLATES) {
    describe(t.title, () => {
      const deck: DeckJSON = t.deck();
      const theme = deck.theme;
      const master = masterFor(theme);

      it('is a deck: 16:9, in one of the themes, with that theme’s own master and layouts', () => {
        expect(deck.v).toBe(1);
        expect(deck.size).toBe('16:9');
        expect(THEMES).toContainEqual(theme);
        expect(deck.master).toEqual(master);
        expect(deck.layouts).toEqual(layoutsFor(theme));
      });

      it('is within the limits, with four to eight slides', () => {
        expect(deck.slides.length).toBeGreaterThanOrEqual(4);
        expect(deck.slides.length).toBeLessThanOrEqual(8);
        expect(deck.slides.length).toBeLessThanOrEqual(DECK_LIMITS.slides);
        for (const [i, s] of deck.slides.entries()) {
          expect(flat(s.elements).length, `slide ${i + 1}`).toBeLessThanOrEqual(DECK_LIMITS.elementsPerSlide);
          for (const e of s.elements) {
            if (e.type === 'table') {
              expect(e.rows.reduce((n, r) => n + r.cells.length, 0)).toBeLessThanOrEqual(DECK_LIMITS.tableCells);
            }
          }
        }
      });

      it('gives every slide a layout the deck has, and ids that are numbered and unique', () => {
        const layouts = new Set(deck.layouts.map((l) => l.id));
        deck.slides.forEach((s, i) => {
          expect(layouts.has(s.layout), `slide ${i + 1}: ${s.layout}`).toBe(true);
          expect(s.id).toBe(`s${i + 1}`);
          const ids = flat(s.elements).map((e) => e.id);
          expect(ids.every(Boolean), `slide ${i + 1} ids`).toBe(true);
          expect(new Set(ids).size, `slide ${i + 1} ids`).toBe(ids.length);
        });
      });

      it('keeps every element inside the slide', () => {
        deck.slides.forEach((s, i) => {
          for (const e of flat(s.elements)) {
            const at = `slide ${i + 1} ${e.name ?? e.id}`;
            expect(e.x, at).toBeGreaterThanOrEqual(0);
            expect(e.y, at).toBeGreaterThanOrEqual(0);
            expect(e.x + e.w, at).toBeLessThanOrEqual(SLIDE_WIDTH);
            expect(e.y + e.h, at).toBeLessThanOrEqual(H);
          }
        });
      });

      it('fills a placeholder from its layout’s, with the geometry and `ph` it has, and text in it', () => {
        deck.slides.forEach((s, i) => {
          const layout = deck.layouts.find((l) => l.id === s.layout)!;
          for (const e of s.elements) {
            if (!e.ph) continue;
            const at = `slide ${i + 1} ${e.name}`;
            const src = layout.elements.find((x) => x.ph?.type === e.ph!.type && x.ph?.idx === e.ph!.idx);
            expect(src, `${at}: no such placeholder on ${layout.id}`).toBeDefined();
            expect(e, at).toMatchObject({ x: src!.x, y: src!.y, w: src!.w, h: src!.h, ph: src!.ph, name: src!.name });
            expect(e.type).toBe('shape');
            if (e.type === 'shape') {
              expect(e.text, at).toBeDefined();
              expect(plainText(e.text).trim().length, at).toBeGreaterThan(0);
            }
          }
        });
      });

      it('puts the footer and the slide number on every slide but a title slide, in that order, over the content', () => {
        for (const s of deck.slides) {
          const feet = s.elements.filter((e) => e.ph && FOOTER_TYPES.includes(e.ph.type));
          if (s.layout === 'title') {
            expect(feet, s.id).toEqual([]);
            continue;
          }
          expect(feet.map((e) => e.ph!.type), s.id).toEqual(['ftr', 'sldNum']);
          expect(s.elements.slice(-2), s.id).toEqual(feet);
          const [ftr, num] = feet as Extract<ElementJSON, { type: 'shape' }>[];
          expect(plainText(ftr!.text).length).toBeGreaterThan(0);
          expect(plainText(num!.text)).toBe(SLIDE_NUMBER_TEXT);
        }
      });

      it('carries one footer through the deck', () => {
        const footers = deck.slides.flatMap((s) => s.elements.filter((e) => e.ph?.type === 'ftr')).map((e) => (e.type === 'shape' ? plainText(e.text) : ''));
        expect(footers.length).toBe(deck.slides.filter((s) => s.layout !== 'title').length);
        expect(new Set(footers).size).toBe(1);
      });

      it('writes titles as sentences with a full stop', () => {
        for (const s of deck.slides) {
          for (const e of s.elements) {
            if (e.ph?.type !== 'title' && e.ph?.type !== 'ctrTitle') continue;
            if (e.type !== 'shape') continue;
            const text = plainText(e.text);
            expect(text, `${s.id}: ${text}`).toMatch(/^[A-Z0-9][^.!?]*\.$/);
          }
        }
      });

      it('has no emoji and no "Lorem"', () => {
        const all = JSON.stringify(deck.slides);
        expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(all.toLowerCase()).not.toContain('lorem');
      });

      it('writes text the slide schema reads: paragraphs of text, with the marks and attrs it has', () => {
        deck.slides.forEach((s, i) => {
          for (const e of flat(s.elements)) {
            if (e.type === 'shape' && e.text) checkText(e.text, `slide ${i + 1} ${e.name}`);
            if (e.type === 'table') for (const r of e.rows) for (const c of r.cells) checkText(c.text, `slide ${i + 1} table`);
          }
          if (s.notes) checkText(s.notes, `slide ${i + 1} notes`);
        });
      });

      it('has speaker notes on a few slides, and not on every one', () => {
        const noted = deck.slides.filter((s) => s.notes);
        expect(noted.length).toBeGreaterThanOrEqual(1);
        expect(noted.length).toBeLessThan(deck.slides.length);
        for (const s of noted) expect(plainText(s.notes).length).toBeGreaterThan(20);
      });

      it('draws every table header in ink that reads on its fill, and sums its columns and rows to its size', () => {
        for (const s of deck.slides) {
          for (const e of s.elements) {
            if (e.type !== 'table') continue;
            expect(e.cols.reduce((a, b) => a + b, 0)).toBe(e.w);
            expect(e.rows.reduce((a, r) => a + r.h, 0)).toBe(e.h);
            for (const row of e.rows) expect(row.cells).toHaveLength(e.cols.length);
            expect(e.firstRow).toBe(true);
            for (const cell of e.rows[0]!.cells) {
              expect(cell.fill?.kind).toBe('solid');
              const ink = cell.text.content[0]!.content![0]!.marks!.find((m) => m.type === 'textStyle')!.attrs!.color as Parameters<typeof resolveColor>[0];
              const fill = cell.fill!.kind === 'solid' ? cell.fill!.color : '#000000';
              expect(contrast(resolveColor(ink, theme), resolveColor(fill, theme))).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      });

      it('is the same JSON every call, and a new value each time', () => {
        const again = t.deck();
        expect(JSON.stringify(again)).toBe(JSON.stringify(deck));
        expect(again).not.toBe(deck);
        expect(again.slides).not.toBe(deck.slides);
      });

      it('holds no undefined, which a Yjs map would refuse, and survives JSON', () => {
        noUndefined(deck, t.slug);
        expect(JSON.parse(JSON.stringify(deck))).toStrictEqual(deck);
      });
    });
  }

  it('give the quarterly report a table and a chart, with the chart’s numbers adding up to the figure on the glance slide', () => {
    const report = findSlidesTemplate(`${PREDEFINED_PREFIX}quarterly-report`)!.deck();
    const els = report.slides.flatMap((s) => s.elements);
    expect(els.some((e) => e.type === 'table')).toBe(true);
    const chart = els.find((e): e is Extract<ElementJSON, { type: 'chart' }> => e.type === 'chart')!;
    expect(chart).toBeDefined();
    expect(chart.alt?.length ?? 0).toBeGreaterThan(20);
    for (const s of chart.series) expect(s.values).toHaveLength(chart.categories.length);
    const published = chart.series[0]!.values.reduce((a, b) => a + b, 0);
    const figure = plainText((report.slides[1]!.elements.find((e) => e.ph?.type === 'subTitle') as Extract<ElementJSON, { type: 'shape' }>).text);
    expect(figure.split('\n')[0]).toBe(String(published));
    // The table's courses column sums to the same figure.
    const table = els.find((e): e is Extract<ElementJSON, { type: 'table' }> => e.type === 'table')!;
    const courses = table.rows.slice(1).reduce((n, r) => n + Number(plainText(r.cells[1]!.text)), 0);
    expect(courses).toBe(published);
  });

  it('start the kick-off as the Slides board does: "What we ship in Q4." beside "40 courses at launch"', () => {
    const kickoff = findSlidesTemplate(`${PREDEFINED_PREFIX}kickoff`)!.deck();
    const slide = kickoff.slides[1]!;
    expect(slide.layout).toBe('bigNumber');
    const text = (type: string) => plainText((slide.elements.find((e) => e.ph?.type === type) as Extract<ElementJSON, { type: 'shape' }>).text);
    expect(text('title')).toBe('What we ship in Q4.');
    expect(text('body').split('\n')).toEqual(['The course library, for every team', 'Onboarding inside Learn', 'Completion reports each Monday', 'Forty courses on day one']);
    expect(text('subTitle').split('\n')).toEqual(['40', 'courses at launch']);
    expect(plainText(slide.notes)).toContain('Start with the forty');
  });

  it('set the teal full stop on a Violet or Midnight title, and nowhere else', () => {
    for (const t of SLIDES_TEMPLATES) {
      const deck = t.deck();
      const dotted = /"color":\{"theme":"accent2"\}/.test(JSON.stringify(deck.slides));
      expect(dotted, t.slug).toBe(deck.theme.id === 'violet' || deck.theme.id === 'midnight');
    }
  });
});
