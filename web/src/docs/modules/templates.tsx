/**
 * Templates: "Save as template" in the File menu and the palette.
 *
 * Three rows, shown by what the document is now: "Save as template" while it is not one,
 * "Save as company template" for an owner or administrator of an organisation, and "Remove
 * from templates" once it is. The acts and the optimism are templates/offer.ts; the shelf
 * they feed is Home's (home/StartSection.tsx).
 *
 * The footer item draws nothing. It is where the module asks, once the page is quiet,
 * whether the company row may be offered, since a module has no hook of its own that runs
 * while the page is open.
 */

import { useEffect } from 'react';
import { buildingsIcon, cardsIcon, xIcon } from '../../core/icons';
import { whenIdle } from '../../core/prefetch';
import { canOfferToOrganisation, loadOrganisation, offer, scopeOf } from '../templates/offer';
import type { DocsContext, DocsModule } from './types';

const unsaved = (c: DocsContext) => c.can.template && scopeOf(c.meta) === null;
const company = (c: DocsContext) => c.can.template && canOfferToOrganisation() && scopeOf(c.meta) !== 'org';
const saved = (c: DocsContext) => c.can.template && scopeOf(c.meta) !== null;

function TemplatesHost({ ctx }: { ctx: DocsContext }) {
  const wanted = ctx.can.template;
  useEffect(() => (wanted ? whenIdle(() => void loadOrganisation(), 500) : undefined), [wanted]);
  return null;
}

export const templatesModule: DocsModule = {
  id: 'templates',
  extensions: [],
  ribbon: [],

  commands: [
    { id: 'file.template', title: 'Save as template', section: 'File', icon: cardsIcon, keywords: ['template'], visible: unsaved, run: (c) => void offer(c, 'user') },
    { id: 'file.template-company', title: 'Save as company template', section: 'File', icon: buildingsIcon, keywords: ['template', 'organisation'], visible: company, run: (c) => void offer(c, 'org') },
    { id: 'file.template-remove', title: 'Remove from templates', section: 'File', icon: xIcon, keywords: ['template'], visible: saved, run: (c) => void offer(c, null) }
  ],

  statusItems: [{ id: 'status.templates-host', side: 'right', order: 1010, render: (c) => <TemplatesHost ctx={c} /> }],

  fileItems: [
    { id: 'file.template', label: 'Save as template', icon: cardsIcon, section: 'Document', order: 450, visible: unsaved, run: (c) => void offer(c, 'user') },
    { id: 'file.template-company', label: 'Save as company template', icon: buildingsIcon, section: 'Document', order: 460, visible: company, run: (c) => void offer(c, 'org') },
    { id: 'file.template-remove', label: 'Remove from templates', icon: xIcon, section: 'Document', order: 470, visible: saved, run: (c) => void offer(c, null) }
  ]
};
