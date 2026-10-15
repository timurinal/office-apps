/**
 * Home's copy of the template shelf, kept right when a document is offered as a template.
 *
 * Home paints the shelf from the last visit and then asks the server (pages/Home.tsx). A
 * document made a template from its File menu would otherwise be missing from "Yours" for
 * the moment between the page painting and the server answering, so the cache is changed
 * when the offer is made, in the same frame. The server's answer replaces it either way.
 */

import type { DocKind, TemplateScope, TemplateSummary } from '@shared/api';
import { readCache, writeCache } from './cache';

/** The cache key of the shelf. */
export const SHELF_KEY = 'templates';

const byTitle = (a: TemplateSummary, b: TemplateSummary): number => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

/** The shelf as the server orders it: the reader's own by title, then the organisation's. */
export const arranged = (shelf: readonly TemplateSummary[]): TemplateSummary[] => [
  ...shelf.filter((t) => t.scope === 'user').sort(byTitle),
  ...shelf.filter((t) => t.scope === 'org').sort(byTitle)
];

/** `scope` null takes the document off the shelf. Nothing is cached before Home has been visited, and then there is nothing to keep right. */
export function noteOffered(doc: { id: string; kind: DocKind; title: string; ownerName: string }, scope: TemplateScope | null): void {
  const cached = readCache<TemplateSummary[]>(SHELF_KEY);
  if (!cached) return;
  const rest = cached.filter((t) => t.id !== doc.id);
  const next = scope ? [...rest, { id: doc.id, kind: doc.kind, title: doc.title, scope, ownerName: doc.ownerName, description: null }] : rest;
  writeCache(SHELF_KEY, arranged(next));
}
