/**
 * A Sheets window: the workbook this window was opened for, in the editor, on a local source.
 *
 * Three ways in: a new blank (`buildSheetSeed`), one of the app's own files, or an Excel, CSV or
 * tab-separated file to import. Each user action is one frame the source sends (`SheetModel`'s
 * step), which is what counts an edit; a save reads the model (`model.export()`), which the
 * footer item hands the session along with the rest of the editor's context.
 */

import { useEffect, useMemo, useState } from 'react';
import type { DocumentMeta } from '@shared/api';
import { decodeCellList, encodeCellList, type CellOp } from '@shared/cells';
import { Button } from '../core/controls';
import { DocumentMessage } from '../core/EditorFrame';
import { useNotify } from '../core/ui';
import { localMeta } from '../docs/source';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { localSheetSource, type SheetSource } from '../sheets/model';
import type { SheetsContext } from '../sheets/modules/types';
import { SheetsEditor } from '../sheets/SheetsEditor';
import { ContainerError, newId, readContainer, writeContainer } from './container';
import { fromBase64, isHostError, useHost, type Host, type OpenRequest } from './host';
import { baseName } from './kinds';
import { Session, setCurrentSession } from './session';
import { useDocumentWindow } from './useDocumentWindow';

interface Opened {
  state: Uint8Array;
  cells: CellOp[];
  title: string;
  id: string;
  path: string | null;
  notes: string[];
}

export async function openSheets(host: Host, open: OpenRequest | null): Promise<Opened> {
  const fresh = { id: newId(), path: null, notes: [] };
  if (!open || open.source === 'new' || open.source === 'template') {
    const { buildSheetSeed } = await import('../sheets/model/seed');
    const seed = buildSheetSeed();
    return { ...fresh, state: seed.state, cells: seed.cells, title: 'Untitled spreadsheet' };
  }
  const bytes = await host.readOpened();
  if (open.source === 'file') {
    const c = readContainer(bytes, 'sheets');
    const cells = decodeCellList(c.cells!);
    if (!cells) throw new ContainerError('cells do not decode');
    return { state: c.state, cells, title: baseName(open.name), id: c.manifest.id, path: open.path, notes: [] };
  }
  const { convertSheetFile } = await import('../formats/browser/sheetsImportClient');
  const out = await convertSheetFile(open.name, bytes);
  const cells = decodeCellList(fromBase64(out.cellsBase64));
  if (!cells) throw new Error('That file could not be read.');
  return { ...fresh, state: fromBase64(out.stateBase64), cells, title: baseName(open.name), notes: out.warnings.map((w) => w.message) };
}

/** The local source, counting each frame the model sends: one per user action. */
export function trackedSheetSource(source: SheetSource, onStep: () => void): SheetSource {
  return {
    kind: source.kind,
    id: source.id,
    features: source.features,
    connect(events) {
      const conn = source.connect(events);
      return {
        ...conn,
        send: (frame) => {
          const sent = conn.send(frame);
          if (sent) onStep();
          return sent;
        }
      };
    }
  };
}

export function LocalSheetsPage() {
  const { host, info } = useHost();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openSheets(host, info.open).then(
      (o) => live && setOpened(o),
      (e: unknown) => {
        host.log('error', `open sheets: ${String(e)}`);
        if (live) setError(e instanceof Error && e.message ? e.message : 'This file could not be opened.');
      }
    );
    return () => {
      live = false;
    };
  }, [host, info]);

  if (error) {
    return (
      <DocumentMessage title="This file could not be opened." text={error === 'This file could not be opened.' ? undefined : error} kind="sheets">
        <Button variant="secondary" onClick={() => host.close(true)}>
          Close
        </Button>
      </DocumentMessage>
    );
  }
  if (!opened) return <DocumentSkeleton kind="sheets" />;
  return <OpenWorkbook opened={opened} />;
}

function OpenWorkbook({ opened }: { opened: Opened }) {
  const { host, info } = useHost();
  const notify = useNotify();

  const session = useMemo(() => new Session({ host, kind: 'sheets', id: opened.id, title: opened.title, path: opened.path }), [host, opened]);
  const source = useMemo(
    () => trackedSheetSource(localSheetSource({ state: opened.state, cells: opened.cells, id: opened.id }), () => session.touch()),
    [opened, session]
  );
  const [meta, setMeta] = useState<DocumentMeta>(() => ({ ...localMeta(opened.title, opened.id), kind: 'sheets' }));

  useEffect(() => {
    session.serialize = () => {
      const ctx = session.ctx as SheetsContext | null;
      if (!ctx || !ctx.model.status().loaded) throw new Error('The spreadsheet is still opening.');
      const file = ctx.model.export();
      return writeContainer({
        kind: 'sheets',
        id: session.id,
        title: session.title,
        app: `${info.appName} ${info.version}`,
        state: file.state,
        cells: encodeCellList(file.cells)
      });
    };
    setCurrentSession(session);
    const off = session.subscribe(() => setMeta((m) => (m.title === session.title ? m : { ...m, title: session.title })));
    return () => {
      off();
      setCurrentSession(null);
    };
  }, [session, info]);

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

  return <SheetsEditor source={source} meta={meta} setMeta={onMeta} />;
}
