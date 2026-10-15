/**
 * Docs' predefined templates.
 *
 * Shipped in the web bundle rather than served by the Worker. A Docs document is a Yjs
 * state built from the editor's schema, and the schema is Tiptap's, which the Worker does
 * not have; keeping the content beside the schema means a change to one is caught by the
 * test of the other (`templates.test.ts` builds every template through the real schema).
 * It also means Suggested is on screen with the page and not after a request, the cards'
 * thumbnails are drawn from the same content, and the desktop app can make one with no
 * server at all.
 *
 * Making a document from one is `create.ts`, which loads the heavy half (`state.ts`) only
 * when a card is pressed. This file is in Home's chunk: it holds the content and nothing
 * that reads it with the editor.
 */

import type { TemplateSummary } from '@shared/api';
import { cv } from './content/cv';
import { letter } from './content/letter';
import { meetingNotes } from './content/meeting-notes';
import { newsletter } from './content/newsletter';
import { projectBrief } from './content/project-brief';
import { report } from './content/report';
import { weeklyPlan } from './content/weekly-plan';
import { sketchOf, type Sketch } from './sketch';
import type { DocsTemplate } from './types';

export type { DocsTemplate } from './types';

/** In the order Suggested shows them. */
export const DOCS_TEMPLATES: readonly DocsTemplate[] = [meetingNotes, projectBrief, report, letter, cv, weeklyPlan, newsletter];

export const PREDEFINED_PREFIX = 'predefined:';

/** The id a card passes on, and `templateId` names. */
export const predefinedId = (t: Pick<DocsTemplate, 'slug'>): string => `${PREDEFINED_PREFIX}${t.slug}`;

export const findDocsTemplate = (id: string): DocsTemplate | undefined =>
  DOCS_TEMPLATES.find((t) => predefinedId(t) === id);

/** The shelf's own shape, so a predefined card is drawn like any other. */
export const predefinedSummaries = (): TemplateSummary[] =>
  DOCS_TEMPLATES.map((t) => ({
    id: predefinedId(t),
    kind: 'docs',
    title: t.title,
    scope: 'predefined',
    ownerName: null,
    description: t.description
  }));

const sketches = new Map<string, Sketch>();

/** What a card draws for a predefined template, from its content. Made once. */
export function sketchFor(id: string): Sketch | null {
  const cached = sketches.get(id);
  if (cached) return cached;
  const t = findDocsTemplate(id);
  if (!t) return null;
  const made = sketchOf(t.body, { wide: t.page?.orientation === 'landscape' });
  sketches.set(id, made);
  return made;
}
