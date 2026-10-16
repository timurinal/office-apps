/**
 * Files: File > Export as PowerPoint, and Save as template, in the File menu and the Ctrl+K box.
 *
 * The pptx writer and its worker are not imported here: a press loads them
 * (`formats/browser/slidesDownload`), so the editor opens without a file writer. The deck is taken
 * as the model has it, so a download of a version being previewed is that version. Gated on
 * `can.download`, the switch a link owner turns off for viewers.
 *
 * The template rows are Docs' (docs/templates/offer.ts): the same three acts, the same optimism,
 * the same shelf on Home. The footer item draws nothing; it asks, once the page is quiet, whether
 * the company row may be offered.
 */

import { useEffect } from 'react';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import filePptRaw from '@phosphor-icons/core/assets/regular/file-ppt.svg?raw';
import { buildingsIcon, cardsIcon, ph, xIcon } from '../../core/icons';
import { whenIdle } from '../../core/prefetch';
import { canOfferToOrganisation, loadOrganisation, offer, scopeOf } from '../../docs/templates/offer';
import type { SlidesContext, SlidesModule } from './types';

const downloadIcon = ph(downloadSimpleRaw);
const pptIcon = ph(filePptRaw);

async function download(c: SlidesContext): Promise<void> {
  // Loaded now, not before: nobody who never downloads fetches a writer.
  const { downloadPptx } = await import('../../formats/browser/slidesDownload');
  await downloadPptx({
    deck: () => c.model.deck(),
    title: c.meta.title,
    assetUrl: c.assets,
    notify: c.notify
  });
}

const allowed = (c: SlidesContext): boolean => c.can.download;
const unsaved = (c: SlidesContext) => c.can.template && scopeOf(c.meta) === null;
const company = (c: SlidesContext) => c.can.template && canOfferToOrganisation() && scopeOf(c.meta) !== 'org';
const saved = (c: SlidesContext) => c.can.template && scopeOf(c.meta) !== null;

function TemplatesHost({ ctx }: { ctx: SlidesContext }) {
  const wanted = ctx.can.template;
  useEffect(() => (wanted ? whenIdle(() => void loadOrganisation(), 500) : undefined), [wanted]);
  return null;
}

export const filesModule: SlidesModule = {
  id: 'files',
  ribbon: [],

  commands: [
    { id: 'file.download-pptx', title: 'Export as PowerPoint', section: 'File', icon: downloadIcon, keywords: ['pptx', 'powerpoint', 'export', 'save', 'download'], visible: allowed, run: (c) => void download(c) },
    { id: 'file.template', title: 'Save as template', section: 'File', icon: cardsIcon, keywords: ['template'], visible: unsaved, run: (c) => void offer(c, 'user') },
    { id: 'file.template-company', title: 'Save as company template', section: 'File', icon: buildingsIcon, keywords: ['template', 'organisation'], visible: company, run: (c) => void offer(c, 'org') },
    { id: 'file.template-remove', title: 'Remove from templates', section: 'File', icon: xIcon, keywords: ['template'], visible: saved, run: (c) => void offer(c, null) }
  ],

  statusItems: [{ id: 'status.templates-host', side: 'right', order: 1010, render: (c) => <TemplatesHost ctx={c} /> }],

  fileItems: [
    { id: 'file.template', label: 'Save as template', icon: cardsIcon, section: 'Document', order: 450, visible: unsaved, run: (c) => void offer(c, 'user') },
    { id: 'file.template-company', label: 'Save as company template', icon: buildingsIcon, section: 'Document', order: 460, visible: company, run: (c) => void offer(c, 'org') },
    { id: 'file.template-remove', label: 'Remove from templates', icon: xIcon, section: 'Document', order: 470, visible: saved, run: (c) => void offer(c, null) },
    // The Export section's slot is 600 to 690 (types.ts), as Docs' and Sheets' are.
    { id: 'file.download-pptx', label: 'Export as PowerPoint (.pptx)', icon: pptIcon, section: 'Export', order: 610, visible: allowed, run: (c) => void download(c) }
  ]
};
