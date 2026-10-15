/**
 * Password-locking a document needs the server, so the desktop app has none of it.
 * The editors gate these dialogs on `can.lock` / `can.unlock`, which a local source
 * never sets; the components keep their real signatures so the editors compile.
 */

import type { DocumentMeta } from '@shared/api';

export function LockDialog(_props: {
  meta: DocumentMeta;
  getState: () => Uint8Array | null;
  onLocked: () => void;
  onClose: () => void;
}): null {
  return null;
}

export function NoShareDialog(_props: { onRemoveLock: () => void; onClose: () => void }): null {
  return null;
}

export function RemovePasswordDialog(_props: {
  meta: DocumentMeta;
  prepare: () => Promise<{ rev: number; state: Uint8Array } | null>;
  onDone: () => void;
  onClose: () => void;
}): null {
  return null;
}
