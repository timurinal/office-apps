/**
 * Offering a document as a template, from its File menu.
 *
 * There are three acts and no dialog: "Save as template" (yours), "Save as company template"
 * (everyone in your organisation, for its owners and administrators) and "Remove from
 * templates". One press answers in the same frame: the toast is up and the shelf on Home is
 * already right before the server has been asked, and a refusal puts both back and says why.
 * An Undo comes with every change, which is the same call the other way.
 *
 * What the page knows about the document is the `DocumentMeta` it was opened with, and that
 * does not change when this page changes it. So what was set here is kept beside it
 * (`scopeOf`), for the File menu to read the next time it opens.
 *
 * Whether the person may offer to their organisation is the server's answer
 * (`ListTemplatesResponse.organisation`), asked once the page is quiet. The PUT decides again.
 */

import type { DocumentMeta, ListTemplatesResponse, TemplateScope } from '@shared/api';
import { errorText } from '../../api';
import { templates } from '../../client';
import type { Toast } from '../../core/ui';
import { optimistic } from '../../home/optimistic';
import { noteOffered } from '../../home/shelf';

export type Scope = TemplateScope | null;

/** What this page set, by document id, over what the meta says. */
const set = new Map<string, Scope>();

export const scopeOf = (meta: Pick<DocumentMeta, 'id' | 'templateScope'>): Scope =>
  set.has(meta.id) ? (set.get(meta.id) ?? null) : meta.templateScope;

type Organisation = ListTemplatesResponse['organisation'];

/** Undefined until asked; null is "not in an organisation". */
let organisation: Organisation | undefined;

export const canOfferToOrganisation = (): boolean => organisation?.canOffer === true;

/** Ask once. A failure leaves it unasked, so the next page asks again, and the company row is not offered meanwhile. */
export async function loadOrganisation(fetchShelf: () => Promise<ListTemplatesResponse> = () => templates.list('docs')): Promise<void> {
  if (organisation !== undefined) return;
  try {
    organisation = (await fetchShelf()).organisation;
  } catch {
    // The row is an extra: without the answer it is simply not offered.
  }
}

export const offerText = (scope: Scope, org: Organisation | undefined): string =>
  scope === 'user' ? 'Saved as a template.' : scope === 'org' ? (org ? `Saved as a template for ${org.name}.` : 'Saved as a company template.') : 'Removed from templates.';

type Page = { meta: DocumentMeta; notify: (toast: Toast) => void };

/**
 * Change what the document is offered as. Resolves true when the server agreed. `undo` is the
 * Undo of a change: it says nothing when it works (the toast it was taken from closes as it
 * runs) and still says why when it does not.
 */
export async function offer(page: Page, scope: Scope, { undo = false }: { undo?: boolean } = {}): Promise<boolean> {
  const { meta, notify } = page;
  const before = scopeOf(meta);
  if (before === scope) return true;
  return optimistic({
    apply: () => {
      set.set(meta.id, scope);
      noteOffered(meta, scope);
      if (!undo) {
        notify({
          text: offerText(scope, organisation),
          action: { label: 'Undo', run: () => void offer(page, before, { undo: true }) }
        });
      }
    },
    commit: () => templates.set(meta.id, scope),
    rollback: () => {
      set.set(meta.id, before);
      noteOffered(meta, before);
    },
    onError: (err) => notify({ text: errorText(err, 'Could not change that.'), tone: 'danger' })
  });
}

/** For tests: forget what this page set and what it was told about the organisation. */
export function resetOffers(): void {
  set.clear();
  organisation = undefined;
}
