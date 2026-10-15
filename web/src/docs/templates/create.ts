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
  const predefined = templateId?.startsWith(PREDEFINED_PREFIX) ? findDocsTemplate(templateId) : undefined;
  if (predefined) {
    const { templateBase64 } = await import('./state');
    return { kind, title: predefined.title, state: templateBase64(predefined) };
  }
  return { kind, ...(templateId ? { templateId } : {}) };
}

/** Start loading what `createRequest` will need, for a pointer that has reached a card. */
export function warmTemplates(): void {
  void import('./state').catch(() => undefined);
}
