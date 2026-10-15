/**
 * What the header and the File menu do to the document as a whole: rename, star, trash, copy,
 * make another, bring it back from the trash. The same acts Docs has, and the same order for
 * each: the screen first, the server second, and the screen put back with a message if the
 * server says no.
 */

import { useMemo } from 'react';
import type { DocKind, DocumentMeta } from '@shared/api';
import { errorText } from '../api';
import { documents } from '../client';
import { useNotify } from '../core/ui';
import { docPath } from '../home/home';
import { useRouter } from '../router';

export interface DocumentActions {
  rename: (title: string) => Promise<void>;
  star: () => Promise<void>;
  trash: () => Promise<void>;
  copy: () => Promise<void>;
  newDocument: (kind?: DocKind) => Promise<void>;
  restoreFromTrash: () => Promise<void>;
}

export function useDocumentActions(meta: DocumentMeta, setMeta: (m: DocumentMeta) => void, reload: () => void, local = false): DocumentActions {
  const notify = useNotify();
  const { navigate } = useRouter();

  return useMemo<DocumentActions>(
    () => ({
      async rename(title) {
        const before = meta;
        setMeta({ ...meta, title });
        // A file's title is the host's to keep; there is no row to rename.
        if (local) return;
        try {
          setMeta(await documents.rename(meta.id, title));
        } catch (err) {
          setMeta(before);
          notify({ text: errorText(err, 'Could not rename it.'), tone: 'danger' });
        }
      },

      async star() {
        const on = !meta.starred;
        setMeta({ ...meta, starred: on });
        try {
          await documents.star(meta.id, on);
        } catch (err) {
          setMeta({ ...meta, starred: !on });
          notify({ text: errorText(err, 'Could not change the star.'), tone: 'danger' });
        }
      },

      async trash() {
        try {
          await documents.trash(meta.id);
          navigate('/');
          notify({
            text: `Moved “${meta.title}” to the trash.`,
            action: {
              label: 'Undo',
              run: () =>
                void documents
                  .restoreFromTrash(meta.id)
                  .then(() => navigate(docPath(meta.kind, meta.id)))
                  .catch((e: unknown) => notify({ text: errorText(e, 'Could not restore it.'), tone: 'danger' }))
            }
          });
        } catch (err) {
          notify({ text: errorText(err, 'Could not move it to the trash.'), tone: 'danger' });
        }
      },

      async copy() {
        try {
          const made = await documents.copy(meta.id);
          navigate(docPath(made.kind, made.id));
          notify({ text: `Made “${made.title}”.` });
        } catch (err) {
          notify({ text: errorText(err, 'Could not make a copy.'), tone: 'danger' });
        }
      },

      async newDocument(kind = 'sheets') {
        try {
          const made = await documents.create({ kind });
          navigate(docPath(made.kind, made.id));
        } catch (err) {
          notify({ text: errorText(err, 'Could not make that document.'), tone: 'danger' });
        }
      },

      async restoreFromTrash() {
        try {
          await documents.restoreFromTrash(meta.id);
          // The room let this socket in read-only while the document was in the trash, so start
          // over and be let in as an editor.
          reload();
        } catch (err) {
          notify({ text: errorText(err, 'Could not restore it.'), tone: 'danger' });
        }
      }
    }),
    [meta, setMeta, reload, notify, navigate, local]
  );
}
