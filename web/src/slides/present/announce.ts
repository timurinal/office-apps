/** What a screen reader hears when the slide changes: its place in the deck and its title. */

import type { ElementJSON, SlideJSON } from '../model/deck';
import { plainText } from '../model/schema';

const isTitle = (e: ElementJSON): boolean => e.type === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle');

/** The slide's title, on one line, or '' for a slide without one. */
export function slideTitle(slide: SlideJSON | null | undefined): string {
  const el = slide?.elements.find((e) => isTitle(e) && e.type === 'shape' && plainText(e.text).trim());
  return el && el.type === 'shape' ? plainText(el.text).replace(/\s+/g, ' ').trim() : '';
}

export function announcement(index: number, count: number, slide: SlideJSON | null | undefined): string {
  const title = slideTitle(slide);
  return title ? `Slide ${index + 1} of ${count}. ${title}` : `Slide ${index + 1} of ${count}.`;
}
