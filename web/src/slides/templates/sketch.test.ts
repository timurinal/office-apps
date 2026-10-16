import { describe, expect, it } from 'vitest';
import type { DeckJSON } from '../model/deck';
import { blankDeck } from '../themes';
import { contrast, resolveColor } from '../themes/color';
import { predefinedSlidesId, SLIDES_TEMPLATES, slidesSketchFor, sketchSlide } from './index';

const HEX = /^#[0-9a-f]{6}$/;

describe('the sketch of a slide', () => {
  it('is a 1920 by 1080 slide with a ground and marks, in resolved colours', () => {
    const s = sketchSlide(SLIDES_TEMPLATES[0]!.deck(), 1);
    expect(s.w).toBe(1920);
    expect(s.h).toBe(1080);
    expect(s.bg).toMatch(HEX);
    expect(s.marks.length).toBeGreaterThan(5);
    for (const m of s.marks) {
      expect(m.fill).toMatch(HEX);
      expect(['rect', 'ellipse']).toContain(m.k);
    }
  });

  it('draws on the slide’s own ground: a title slide on its colour, a content slide on the master’s', () => {
    const deck = SLIDES_TEMPLATES[0]!.deck();
    const title = sketchSlide(deck, 0);
    const content = sketchSlide(deck, 2);
    expect(title.bg).toBe(resolveColor({ theme: 'accent1', lum: -0.03 }, deck.theme));
    expect(content.bg).toBe('#fbfaff');
  });

  it('draws the figure card of the kick-off, with the figure and its caption in it', () => {
    const deck = SLIDES_TEMPLATES[0]!.deck();
    const s = sketchSlide(deck, 1);
    const violet = resolveColor({ theme: 'accent1', lum: -0.03 }, deck.theme);
    const card = s.marks.find((m) => m.fill === violet && m.w > 400)!;
    expect(card).toBeDefined();
    expect(card.r).toBeGreaterThan(20);
    // Bars inside the card are the figure and its caption, in white over it.
    const inside = s.marks.filter((m) => m !== card && m.x >= card.x && m.x + m.w <= card.x + card.w && m.y >= card.y && m.y + m.h <= card.y + card.h);
    expect(inside.length).toBeGreaterThanOrEqual(2);
    for (const m of inside) expect(contrast(m.fill, card.fill)).toBeGreaterThan(2);
  });

  it('draws a bullet and a bar for each point of a list, in order down the slide', () => {
    const s = sketchSlide(SLIDES_TEMPLATES[0]!.deck(), 2);
    const dots = s.marks.filter((m) => m.k === 'ellipse');
    expect(dots).toHaveLength(4);
    for (let i = 1; i < dots.length; i++) expect(dots[i]!.y).toBeGreaterThan(dots[i - 1]!.y);
  });

  it('draws a chart as bars and a table as a header band over rows', () => {
    const report = SLIDES_TEMPLATES.find((t) => t.slug === 'quarterly-report')!.deck();
    const chart = sketchSlide(report, 2);
    expect(chart.marks.filter((m) => m.fill === report.theme.colors.accent1 && m.h > 100).length).toBe(3);
    const table = sketchSlide(report, 3);
    const band = table.marks.find((m) => m.w === 1612 && m.h === 80)!;
    expect(band).toBeDefined();
    expect(table.marks.filter((m) => m.w === 1612).length).toBeGreaterThan(2);
  });

  it('keeps every mark inside the slide, and does not draw a footer', () => {
    for (const t of SLIDES_TEMPLATES) {
      const deck = t.deck();
      for (let i = 0; i < deck.slides.length; i++) {
        const s = sketchSlide(deck, i);
        for (const m of s.marks) {
          const at = `${t.slug} slide ${i + 1}`;
          expect(m.x, at).toBeGreaterThanOrEqual(0);
          expect(m.y, at).toBeGreaterThanOrEqual(0);
          expect(m.x + m.w, at).toBeLessThanOrEqual(s.w);
          expect(m.y + m.h, at).toBeLessThanOrEqual(s.h);
        }
        // The footer line is at y 972; nothing drawn there on a content slide.
        if (deck.slides[i]!.layout === 'titleContent') expect(s.marks.some((m) => m.y > 960)).toBe(false);
      }
    }
  });

  it('holds a bounded number of marks, however many shapes the slide has', () => {
    const deck: DeckJSON = blankDeck();
    deck.slides[0]!.elements = Array.from({ length: 400 }, (_, i) => ({
      type: 'shape' as const, shape: 'rect' as const, x: (i % 20) * 90, y: Math.floor(i / 20) * 50, w: 80, h: 40, fill: { kind: 'solid' as const, color: '#112233' }
    }));
    expect(sketchSlide(deck).marks.length).toBeLessThanOrEqual(200);
  });

  it('is the same twice, and answers for an index that is out of range with the nearest slide', () => {
    const deck = SLIDES_TEMPLATES[1]!.deck();
    expect(sketchSlide(deck, 1)).toEqual(sketchSlide(deck, 1));
    expect(sketchSlide(deck, 99)).toEqual(sketchSlide(deck, deck.slides.length - 1));
    expect(sketchSlide(deck, -3)).toEqual(sketchSlide(deck, 0));
  });

  it('draws an empty deck’s title slide without text', () => {
    const s = sketchSlide(blankDeck());
    // The ground and the accent rule, and nothing for the placeholders: they are empty.
    expect(s.marks).toHaveLength(1);
  });
});

describe('slidesSketchFor', () => {
  it('draws each template’s cover once, and answers null for an id nobody has', () => {
    for (const t of SLIDES_TEMPLATES) {
      const id = predefinedSlidesId(t);
      const s = slidesSketchFor(id);
      expect(s, t.slug).not.toBeNull();
      expect(slidesSketchFor(id)).toBe(s);
      expect(s).toEqual(sketchSlide(t.deck(), t.cover ?? 0));
    }
    expect(slidesSketchFor('predefined:nope')).toBeNull();
    expect(slidesSketchFor('nope')).toBeNull();
  });

  it('draws six covers that differ, so the shelf does not look like one card six times', () => {
    const covers = SLIDES_TEMPLATES.map((t) => JSON.stringify(slidesSketchFor(predefinedSlidesId(t))));
    expect(new Set(covers).size).toBe(6);
    const grounds = SLIDES_TEMPLATES.map((t) => slidesSketchFor(predefinedSlidesId(t))!.bg);
    expect(new Set(grounds).size).toBeGreaterThanOrEqual(5);
  });
});

describe('the sketch of a faded fill', () => {
  it('draws a shape with alpha as the colour a viewer sees over the ground', () => {
    const deck: DeckJSON = blankDeck();
    deck.slides[0]!.layout = 'blank';
    deck.slides[0]!.elements = [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 400, h: 300, fill: { kind: 'solid', color: '#000000', alpha: 0.5 } }];
    const [mark] = sketchSlide(deck).marks.slice(-1);
    // Violet's ground is #fbfaff and a half of black over it is that halved.
    expect(mark!.fill).toBe('#7e7d80');
  });
});
