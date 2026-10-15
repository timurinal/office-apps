import { describe, expect, it } from 'vitest';
import type { SlideJSON } from '../model/deck';
import { txt } from '../model/testing';
import { announcement, slideTitle } from './announce';

const slide = (...elements: SlideJSON['elements']): SlideJSON => ({ id: 's', layout: 'blank', elements });
const title = (text: string, type: 'title' | 'ctrTitle' = 'title'): SlideJSON['elements'][number] => ({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, ph: { type }, text: txt(text) });

describe('what is announced for a slide', () => {
  it('is its place and its title', () => {
    expect(announcement(1, 6, slide(title('What we ship in Q4.')))).toBe('Slide 2 of 6. What we ship in Q4.');
  });

  it('is its place alone when there is no title', () => {
    expect(announcement(0, 3, slide())).toBe('Slide 1 of 3.');
    expect(announcement(0, 3, null)).toBe('Slide 1 of 3.');
  });

  it('reads a centred title, and one on two lines as one', () => {
    expect(slideTitle(slide(title('Kick-off', 'ctrTitle')))).toBe('Kick-off');
    expect(slideTitle(slide(title('Two\nlines')))).toBe('Two lines');
  });

  it('skips a title that is empty and a body that is not a title', () => {
    const body: SlideJSON['elements'][number] = { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, ph: { type: 'body' }, text: txt('Not me') };
    expect(slideTitle(slide(body, title('')))).toBe('');
    expect(slideTitle(slide(body, title('Me')))).toBe('Me');
  });
});
