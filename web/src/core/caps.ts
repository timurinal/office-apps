/**
 * What this person can do to this document, from the `DocumentMeta` the API
 * returned. The server decides every one of these again on the request; this is
 * only so the page does not offer what it will refuse.
 */

import { ROLE_RANK, type DocumentMeta } from '@shared/api';

export interface Caps {
  /** The owner: shares, locks, trashes, renames. */
  owner: boolean;
  /** Types in the page. Nobody does in the trash, whatever their role. */
  canEdit: boolean;
  canComment: boolean;
  /** Opens the share dialog. The server still decides who may see the list. */
  canShare: boolean;
  /** Sees history: editors who are signed in. A version can hold text an editor
   *  has since removed, so it is not offered to readers or to link guests. */
  canSeeHistory: boolean;
  /** A link visitor with a viewer or commenter role, on a link with downloads off. */
  restricted: boolean;
  guest: boolean;
  trashed: boolean;
}

export function capsFor(
  meta: Pick<DocumentMeta, 'role' | 'principal' | 'canDownload' | 'trashedAt' | 'locked'>
): Caps {
  const rank = ROLE_RANK[meta.role];
  const trashed = meta.trashedAt !== null;
  const user = meta.principal === 'user';
  const editor = rank >= ROLE_RANK.editor;
  const live = !trashed && !meta.locked;
  return {
    owner: meta.role === 'owner',
    canEdit: !trashed && editor,
    canComment: live && rank >= ROLE_RANK.commenter,
    canShare: live && user && editor,
    canSeeHistory: live && user && editor,
    restricted: !meta.canDownload && rank < ROLE_RANK.editor,
    guest: !user,
    trashed
  };
}

/** The role in the words the header shows next to a read-only page. */
export function readOnlyNote(meta: Pick<DocumentMeta, 'role'>, trashed: boolean): string | null {
  if (trashed) return 'In the trash';
  if (meta.role === 'viewer') return 'View only';
  if (meta.role === 'commenter') return 'Comment only';
  return null;
}
