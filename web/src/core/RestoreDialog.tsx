/**
 * "Restore this version?": the confirmation over the whole document that the history pane
 * leaves to the page, because a restore replaces everything on screen.
 *
 * Docs has its own copy of this in docs/DocsEditor.tsx, from before a second editor needed it;
 * Sheets uses this one.
 */

import type { VersionSummary } from '@shared/api';
import { Button } from './controls';
import { Modal, useModalClose } from './ui';
import { whenPhrase } from './versions';

function RestoreFooter({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="secondary" disabled={busy} onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" disabled={busy} onClick={onConfirm}>
        {busy ? 'Restoring' : 'Restore'}
      </Button>
    </>
  );
}

export function RestoreDialog({
  version,
  noun = 'document',
  busy,
  onConfirm,
  onClose
}: {
  version: VersionSummary;
  /** What it is, for "The spreadsheet goes back to how it was". */
  noun?: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Restore this version?" width={440} onClose={onClose} footer={<RestoreFooter busy={busy} onConfirm={onConfirm} />}>
      <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-3)' }}>
        The {noun} goes back to how it was {whenPhrase(version.createdAt, Math.floor(Date.now() / 1000))}. What it holds now is kept as a
        version.
      </p>
    </Modal>
  );
}
