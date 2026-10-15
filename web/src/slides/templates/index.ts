/**
 * Slides' predefined templates: six presentations built from the themes and layouts
 * (`slides/themes`), with real content and speaker notes.
 *
 * Shipped in the web bundle, as Docs' are (`docs/templates/index.ts` says why): a card is on screen
 * with the page, its thumbnail is drawn from the same content, and a deck can be made with no
 * server at all. A template is a function that builds a `DeckJSON`; the press that makes a document
 * calls it, writes the deck into a new document's Yjs state (`slides/model`'s `deckToY`) and posts
 * that as `state`, as a Docs template does.
 *
 * Pure: no DOM and no Yjs. Home loads it when it draws a card (`home/SlideSketchThumb.tsx`), and names
 * the cards from `summaries.ts` before that.
 */

import { kickoff } from './content/kickoff';
import { lesson } from './content/lesson';
import { pitch } from './content/pitch';
import { quarterlyReport } from './content/quarterly-report';
import { weeklyUpdate } from './content/weekly-update';
import { workshop } from './content/workshop';
import { sketchSlide, type SlideSketch } from './sketch';
import { predefinedSlidesId } from './summaries';
import type { SlidesTemplate } from './types';

export type { SlidesTemplate } from './types';
export { sketchSlide, type SlideSketch, type SketchMark } from './sketch';
export { PREDEFINED_PREFIX, predefinedSlidesId, predefinedSlidesSummaries } from './summaries';

/** In the order Suggested shows them. */
export const SLIDES_TEMPLATES: readonly SlidesTemplate[] = [kickoff, pitch, weeklyUpdate, lesson, quarterlyReport, workshop];

export const findSlidesTemplate = (id: string): SlidesTemplate | undefined => SLIDES_TEMPLATES.find((t) => predefinedSlidesId(t) === id);

const sketches = new Map<string, SlideSketch>();

/** What a card draws for a predefined template, from its content. Made once. */
export function slidesSketchFor(id: string): SlideSketch | null {
  const cached = sketches.get(id);
  if (cached) return cached;
  const t = findSlidesTemplate(id);
  if (!t) return null;
  const made = sketchSlide(t.deck(), t.cover ?? 0);
  sketches.set(id, made);
  return made;
}
