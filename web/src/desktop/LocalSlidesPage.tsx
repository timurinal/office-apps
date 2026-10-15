/**
 * A Slides window: the presentation this window was opened for, in the editor, on a local source.
 *
 * Four ways in: a new blank (the default theme's title slide), a predefined template, one of the
 * app's own files, or a PowerPoint file to import. The first, second and fourth have no file until
 * Save asks where. A deck's pictures are not in its Yjs state but in the window's `PictureStore`,
 * and the file carries them beside it (`container.ts`).
 *
 * A window whose address says `present=audience` is the audience's half of a presenter's view,
 * fed from the presenter's window (`deckMirror.ts`).
 */

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import type { DocumentMeta } from '@shared/api';
import { Button } from '../core/controls';
import { DocumentMessage } from '../core/EditorFrame';
import { useNotify } from '../core/ui';
import { localSource } from '../docs/source';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { useRouter } from '../router';
import { deckToY, replaceAssetIds, yToDeck } from '../slides/model/ydoc';
import { AudienceSkeleton, AudienceWindow, audienceParams, type AudienceParams } from '../slides/present';
import { SlidesEditor } from '../slides/SlidesEditor';
import { blankDeck } from '../slides/themes';
import { newId, readContainer, writeContainer } from './container';
import { followDeck, serveDeck, type Followed } from './deckMirror';
import { fromBase64, isHostError, useHost, type Host, type OpenRequest } from './host';
import { baseName } from './kinds';
import { newPictureId, pictureIdsIn, PictureStore, type StoredPicture } from './pictures';
import { Session, setCurrentSession } from './session';
import { registerPictureStore } from './slidesPictures';
import { useDocumentWindow } from './useDocumentWindow';

interface Opened {
  state: Uint8Array;
  pictures: StoredPicture[];
  title: string;
  id: string;
  path: string | null;
  notes: string[];
}

/** A new deck's theme: a plain blue one, not the first in the list. */
export const NEW_DECK_THEME = 'harbour';

export async function openSlides(host: Host, open: OpenRequest | null): Promise<Opened> {
  const fresh = { id: newId(), path: null, notes: [], pictures: [] };
  if (!open || open.source === 'new') return { ...fresh, state: deckToY(blankDeck(NEW_DECK_THEME)), title: 'Untitled presentation' };
  if (open.source === 'template') {
    const { findSlidesTemplate } = await import('../slides/templates');
    const t = findSlidesTemplate(open.templateId);
    if (!t) return { ...fresh, state: deckToY(blankDeck(NEW_DECK_THEME)), title: 'Untitled presentation' };
    return { ...fresh, state: deckToY(t.deck()), title: t.title };
  }
  const bytes = await host.readOpened();
  if (open.source === 'file') {
    const c = readContainer(bytes, 'slides');
    return { state: c.state, pictures: c.pictures, title: baseName(open.name), id: c.manifest.id, path: open.path, notes: [] };
  }
  const { convertSlidesFile } = await import('../formats/browser/slidesImportClient');
  const out = await convertSlidesFile(open.name, bytes);
  // The converter names each picture by a placeholder; here each gets an id of the store's.
  const ids = new Map<string, string>();
  const pictures = out.images.map((img) => {
    const id = newPictureId();
    ids.set(img.token, id);
    return { id, mime: img.mime, name: img.name, bytes: img.bytes };
  });
  let state = fromBase64(out.stateBase64);
  if (ids.size > 0) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    replaceAssetIds(doc, ids);
    state = Y.encodeStateAsUpdate(doc);
  }
  return { ...fresh, state, pictures, title: baseName(open.name), notes: out.warnings.map((w) => w.message) };
}

export function LocalSlidesPage() {
  const { host, info } = useHost();
  const { query } = useRouter();
  const audience = useMemo(() => audienceParams(query), [query]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (audience) return;
    let live = true;
    openSlides(host, info.open).then(
      (o) => live && setOpened(o),
      (e: unknown) => {
        host.log('error', `open slides: ${String(e)}`);
        if (live) setError(e instanceof Error && e.message ? e.message : 'This file could not be opened.');
      }
    );
    return () => {
      live = false;
    };
  }, [host, info, audience]);

  if (audience) return <LocalAudience params={audience} presenter={query.get('w') ?? ''} />;
  if (error) {
    return (
      <DocumentMessage title="This file could not be opened." text={error === 'This file could not be opened.' ? undefined : error} kind="slides">
        <Button variant="secondary" onClick={() => host.close(true)}>
          Close
        </Button>
      </DocumentMessage>
    );
  }
  if (!opened) return <DocumentSkeleton kind="slides" />;
  return <OpenDeck opened={opened} />;
}

/** The pictures of the deck `id`, which the editor draws from as soon as it renders. */
function usePictures(id: string, initial: readonly StoredPicture[]): PictureStore {
  // Registered while rendering, so the editor's first render finds it, and again on mount.
  const store = useMemo(() => {
    const s = new PictureStore(initial);
    registerPictureStore(id, s);
    return s;
  }, [id, initial]);
  useEffect(() => registerPictureStore(id, store), [id, store]);
  return store;
}

function OpenDeck({ opened }: { opened: Opened }) {
  const { host, info } = useHost();
  const notify = useNotify();

  const doc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, opened.state);
    return d;
  }, [opened]);
  const pictures = usePictures(opened.id, opened.pictures);
  const session = useMemo(() => new Session({ host, kind: 'slides', id: opened.id, title: opened.title, path: opened.path }), [host, opened]);
  const source = useMemo(() => localSource({ title: opened.title, doc, id: opened.id }), [doc, opened]);
  const [meta, setMeta] = useState<DocumentMeta>(() => ({ ...source.meta, kind: 'slides' }));

  useEffect(() => {
    session.serialize = () => {
      // Only the pictures the deck still names: one taken off a slide is not kept in the file.
      const used = pictureIdsIn(yToDeck(doc));
      return writeContainer({
        kind: 'slides',
        id: session.id,
        title: session.title,
        app: `${info.appName} ${info.version}`,
        state: Y.encodeStateAsUpdate(doc),
        pictures: pictures.list(used)
      });
    };
    setCurrentSession(session);
    const onUpdate = () => session.touch();
    doc.on('update', onUpdate);
    const off = session.subscribe(() => setMeta((m) => (m.title === session.title ? m : { ...m, title: session.title })));
    const stopServing = serveDeck(info.windowId, { id: opened.id, doc, pictures, title: () => session.title });
    return () => {
      doc.off('update', onUpdate);
      off();
      stopServing();
      setCurrentSession(null);
    };
  }, [session, doc, pictures, info, opened]);

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

  return <SlidesEditor source={source} meta={meta} setMeta={onMeta} />;
}

// ── the audience's window ───────────────────────────────────────────────────

function LocalAudience({ params, presenter }: { params: AudienceParams; presenter: string }) {
  const [deck, setDeck] = useState<Followed | null>(null);
  const [store] = useState(() => new PictureStore());

  useEffect(() => {
    if (!presenter) return;
    return followDeck(presenter, {
      deck: (d) => {
        for (const p of d.pictures) store.add(p);
        registerPictureStore(d.id, store);
        setDeck(d);
      },
      picture: (p) => store.add(p)
    });
  }, [presenter, store]);

  useEffect(() => (deck ? registerPictureStore(deck.id, store) : undefined), [deck, store]);

  const source = useMemo(() => (deck ? localSource({ title: deck.title, doc: deck.doc, id: deck.id }) : null), [deck]);
  if (!deck || !source) return <AudienceSkeleton />;
  return <AudienceWindow source={source} meta={{ ...source.meta, kind: 'slides' }} show={params.show} at={params.at} />;
}
