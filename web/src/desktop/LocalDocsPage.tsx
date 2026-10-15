/**
 * A Docs window: the document this window was opened for, in the editor, on a local source.
 *
 * Four ways in: a new blank, a predefined template (built here, `docs/templates/state.ts`), one
 * of the app's own files, or a Word, Markdown, HTML or text file to import. The first, second
 * and fourth have no file until Save asks where.
 */

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import type { DocumentMeta } from '@shared/api';
import { Button } from '../core/controls';
import { DocumentMessage } from '../core/EditorFrame';
import { useNotify } from '../core/ui';
import { DocsEditor } from '../docs/DocsEditor';
import { localSource } from '../docs/source';
import { findDocsTemplate } from '../docs/templates';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { newId, readContainer, writeContainer } from './container';
import { isHostError, useHost, type Host, type OpenRequest } from './host';
import { importDocsFile } from './importDocs';
import { baseName } from './kinds';
import { Session, setCurrentSession } from './session';
import { useDocumentWindow } from './useDocumentWindow';

interface Opened {
  state: Uint8Array | null;
  title: string;
  id: string;
  path: string | null;
  notes: string[];
}

export async function openDocs(host: Host, open: OpenRequest | null): Promise<Opened> {
  const fresh = { id: newId(), path: null, notes: [] };
  if (!open || open.source === 'new') return { ...fresh, state: null, title: 'Untitled document' };
  if (open.source === 'template') {
    const t = findDocsTemplate(open.templateId);
    if (!t) return { ...fresh, state: null, title: 'Untitled document' };
    const { templateState } = await import('../docs/templates/state');
    return { ...fresh, state: templateState(t), title: t.title };
  }
  const bytes = await host.readOpened();
  if (open.source === 'file') {
    const c = readContainer(bytes, 'docs');
    return { state: c.state, title: baseName(open.name), id: c.manifest.id, path: open.path, notes: [] };
  }
  const imported = await importDocsFile(open.name, bytes);
  return { ...fresh, state: imported.state, title: baseName(open.name), notes: imported.notes };
}

export function LocalDocsPage() {
  const { host, info } = useHost();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openDocs(host, info.open).then(
      (o) => live && setOpened(o),
      (e: unknown) => {
        host.log('error', `open docs: ${String(e)}`);
        if (live) setError(e instanceof Error && e.message ? e.message : 'This file could not be opened.');
      }
    );
    return () => {
      live = false;
    };
  }, [host, info]);

  if (error) {
    return (
      <DocumentMessage title="This file could not be opened." text={error === 'This file could not be opened.' ? undefined : error} kind="docs">
        <Button variant="secondary" onClick={() => host.close(true)}>
          Close
        </Button>
      </DocumentMessage>
    );
  }
  if (!opened) return <DocumentSkeleton kind="docs" />;
  return <OpenDocument opened={opened} />;
}

function OpenDocument({ opened }: { opened: Opened }) {
  const { host, info } = useHost();
  const notify = useNotify();

  const doc = useMemo(() => {
    const d = new Y.Doc();
    if (opened.state) Y.applyUpdate(d, opened.state);
    return d;
  }, [opened]);
  const session = useMemo(() => new Session({ host, kind: 'docs', id: opened.id, title: opened.title, path: opened.path }), [host, opened]);
  const source = useMemo(() => localSource({ title: opened.title, doc, id: opened.id }), [doc, opened]);
  const [meta, setMeta] = useState<DocumentMeta>(source.meta);

  useEffect(() => {
    session.serialize = () =>
      writeContainer({ kind: 'docs', id: session.id, title: session.title, app: `${info.appName} ${info.version}`, state: Y.encodeStateAsUpdate(doc) });
    setCurrentSession(session);
    const onUpdate = () => session.touch();
    doc.on('update', onUpdate);
    // The title follows the file: Save as and a rename change it.
    const off = session.subscribe(() => setMeta((m) => (m.title === session.title ? m : { ...m, title: session.title })));
    return () => {
      doc.off('update', onUpdate);
      off();
      setCurrentSession(null);
    };
  }, [session, doc, info]);

  useEffect(() => {
    if (opened.notes.length) notify({ text: opened.notes.join(' ') });
  }, [opened, notify]);

  useDocumentWindow(session, host, notify, info.platform === 'web');

  const onMeta = (next: DocumentMeta) => {
    setMeta(next);
    if (next.title === session.title) return;
    session.rename(next.title).then(
      (title) => setMeta((m) => ({ ...m, title })),
      (err: unknown) => {
        setMeta((m) => ({ ...m, title: session.title }));
        notify({ text: isHostError(err) ? err.message : 'Could not rename it.', tone: 'danger' });
      }
    );
  };

  return <DocsEditor source={source} meta={meta} setMeta={onMeta} />;
}
