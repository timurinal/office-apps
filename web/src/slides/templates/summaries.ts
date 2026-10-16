/**
 * The Slides templates as Home names them: a slug, a title and a line, and nothing else.
 *
 * This is the half of `slides/templates` that is in Home's chunk. The decks, the themes they are
 * built from and the code that sketches a card's slide (`index.ts`, `sketch.ts`) are loaded when a
 * card is drawn, so Home does not carry six presentations to name them. `summaries.test.ts` holds
 * this list to the templates' own titles and order.
 */

import type { TemplateSummary } from '@shared/api';

/** In the order Suggested shows them. */
export const SLIDES_TEMPLATE_NAMES: readonly { slug: string; title: string; description: string }[] = [
  { slug: 'kickoff', title: 'Project kick-off', description: 'What we ship, who owns it and when, in six slides.' },
  { slug: 'pitch', title: 'Pitch', description: 'The problem, the answer and the ask, in seven slides.' },
  { slug: 'weekly-update', title: 'Weekly update', description: 'Progress, what is done and next, status and what you need.' },
  { slug: 'lesson', title: 'Lesson', description: 'Aims, an explanation, an exercise and a recap.' },
  { slug: 'quarterly-report', title: 'Quarterly report', description: 'Results, a table and a chart for the quarter.' },
  { slug: 'workshop', title: 'Workshop agenda', description: 'A timed agenda, ground rules and what happens next.' }
];

/** The same prefix as `docs/templates`. It is repeated here so this file does not pull Docs' content in; the test pins it. */
export const PREDEFINED_PREFIX = 'predefined:';

/** The id a card passes on. */
export const predefinedSlidesId = (t: { slug: string }): string => `${PREDEFINED_PREFIX}${t.slug}`;

/** The shelf's own shape, so a predefined card is drawn like any other. */
export const predefinedSlidesSummaries = (): TemplateSummary[] =>
  SLIDES_TEMPLATE_NAMES.map((t) => ({
    id: predefinedSlidesId(t),
    kind: 'slides',
    title: t.title,
    scope: 'predefined',
    ownerName: null,
    description: t.description
  }));
