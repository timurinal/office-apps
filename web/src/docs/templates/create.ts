/**
 * The create call for a card on Home.
 *
 * A predefined template is made in the browser (index.ts says why), so its request carries
 * the document's content as `state`; every other card is the server's own copy of a document
 * and carries only the `templateId`. The first needs the editor's schema, which is loaded
 * here, on the press, and not with Home.
 */

import type { CreateDocumentRequest, DocKind } from '@shared/api';
import { findDocsTemplate, PREDEFINED_PREFIX } from './index';

export async function createRequest(kind: DocKind, templateId?: string): Promise<CreateDocumentRequest> {
  const predefined = templateId?.startsWith(PREDEFINED_PREFIX);
  // A Slides template is a deck written into a new document's Yjs state, as a Docs one is. The
  // decks are not in Home's chunk either (slides/templates/summaries.ts).
  if (predefined && kind === 'slides') {
    const [{ findSlidesTemplate }, { slidesTemplateBase64 }] = await Promise.all([import('../../slides/templates'), import('../../slides/templates/state')]);
    const deck = findSlidesTemplate(templateId!);
    if (deck) return { kind, title: deck.title, state: slidesTemplateBase64(deck) };
  }
  const page = predefined && kind === 'docs' ? findDocsTemplate(templateId!) : undefined;
  if (page) {
    const { templateBase64 } = await import('./state');
    return { kind, title: page.title, state: templateBase64(page) };
  }
  return { kind, ...(templateId ? { templateId } : {}) };
}

/** Start loading what `createRequest` will need, for a pointer that has reached a card. */
export function warmTemplates(kind: DocKind = 'docs'): void {
  const loads = kind === 'slides' ? [import('../../slides/templates'), import('../../slides/templates/state')] : [import('./state')];
  for (const load of loads) void load.catch(() => undefined);
}
