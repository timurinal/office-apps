/**
 * A Docs document, on whatever source it comes from.
 *
 * This component owns everything that has to agree with everything else on the
 * screen: the connection, the editor it feeds, the modules' contributions, the
 * header that shows who is here, and the panes and dialogs that act on the
 * document. They hang off it because a restore, a revoked share or a document in the
 * trash changes all of them at once.
 *
 * It does not know where the document lives. `source` (docs/source.ts) says which
 * server features exist, and everything that needs one is hidden when it does not:
 * a local file in the desktop app gets the page, the ribbon, the palette and the
 * File menu, and no comments, sharing, history or people.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import type { DocKind, DocumentMeta, VersionSummary } from '@shared/api';
import { errorText } from '../api';
import { documents, versions as versionsApi } from '../client';
import { capsFor } from '../core/caps';
import { colorFor } from '../core/color';
import { Button } from '../core/controls';
import { HomeButton, SignInButton } from '../core/EditorFrame';
import { fileTextIcon } from '../core/icons';
import { HistoryPanel } from '../core/HistoryPanel';
import { LockDialog, NoShareDialog, RemovePasswordDialog } from '../core/LockDialogs';
import { CommandSearch } from '../core/palette/CommandSearch';
import { ShareDialog } from '../core/ShareDialog';
import { EditorShell, type ShellPane } from '../core/shell/EditorShell';
import { FileMenu } from '../core/shell/FileMenu';
import { EditingModeMenu } from '../core/shell/Ribbon';
import { statusFor } from '../core/shell/registry';
import type { FileItem, PaneSpec } from '../core/shell/types';
import { AppKindProvider, Banner, Bone, Modal, useModalClose, useNotify } from '../core/ui';
import { checkAccess } from '../core/useDocument';
import { versionTitle, whenPhrase } from '../core/versions';
import { docPath } from '../home/home';
import { viewTransition } from '../motion/viewTransition';
import { useRouter } from '../router';
import { useApp } from '../state';
import { useDocsContextMenu } from './core/contextMenu';
import { baseExtensions, documentExtensions } from './extensions';
import { collect } from './modules/collect';
import { DOCS_MODULES } from './modules';
import { DOCS_TABS, type DocsActions, type DocsCan, type DocsContext, type PaneApi } from './modules/types';
import { Page, PageEditor } from './PageEditor';
import { startComment } from './review/actions';
import { useOpenThreads } from './review/store';
import { liveStatus, type StopReason } from './room';
import type { DocumentSource } from './source';
import { avatarSrc } from '../theme';
import { usePeers, useConnection } from './useConnection';

const STOP_TEXT: Record<StopReason, string> = {
  revoked: 'You no longer have access to this document.',
  'no-access': 'You can no longer open this document.',
  'signed-out': 'Your session ended. Sign in to keep editing.',
  'too-large': 'This document is too large to keep editing. Your last change was not saved.',
  protocol: 'This document could not be kept in sync.'
};

const COLLECTED = collect(DOCS_MODULES);

/** A version's state, shown read-only in place of the page. */
function Preview({ documentId, version }: { documentId: string; version: VersionSummary }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; doc: Y.Doc } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let live = true;
    let doc: Y.Doc | null = null;
    setState({ status: 'loading' });
    versionsApi
      .snapshot(documentId, version.id)
      .then((bytes) => {
        if (!live) return;
        doc = new Y.Doc();
        Y.applyUpdate(doc, bytes);
        setState({ status: 'ready', doc });
      })
      .catch((err: unknown) => live && setState({ status: 'error', message: errorText(err, 'Could not open that version.') }));
    return () => {
      live = false;
      doc?.destroy();
    };
  }, [documentId, version.id]);

  const extensions = useMemo(
    () => (state.status === 'ready' ? baseExtensions({ doc: state.doc, awareness: null }) : null),
    [state]
  );

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Bone w="46%" h={18} />
        {['100%', '96%', '98%', '72%', '100%', '94%', '58%'].map((w, i) => (
          <Bone key={i} w={w} h={11} />
        ))}
      </div>
    );
  }
  if (state.status === 'error') return <Banner tone="danger">{state.message}</Banner>;
  return extensions ? <PageEditor extensions={extensions} editable={false} /> : null;
}

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

function RestoreDialog({
  version,
  busy,
  onConfirm,
  onClose
}: {
  version: VersionSummary;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Restore this version?" width={440} onClose={onClose} footer={<RestoreFooter busy={busy} onConfirm={onConfirm} />}>
      <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-3)' }}>
        The document goes back to how it was {whenPhrase(version.createdAt, Math.floor(Date.now() / 1000))}. What it holds now is kept
        as a version.
      </p>
    </Modal>
  );
}

export interface DocsEditorProps {
  source: DocumentSource;
  /** What the API says about the document, or `localMeta` for a file. */
  meta: DocumentMeta;
  /** Replace the meta after a change the page made (a rename, a star). */
  setMeta?: (m: DocumentMeta) => void;
  /** Ask again without blanking the page: a role changed. */
  refresh?: () => Promise<void>;
  /** Start over, with the loading state. */
  reload?: () => void;
  /** File menu rows the page adds: the desktop app's Save, the web's "Open in the desktop app". */
  fileItems?: readonly FileItem<unknown>[];
}

const nothing = (): void => undefined;
const nothingAsync = async (): Promise<void> => undefined;

export function DocsEditor({ source, meta, setMeta = nothing, refresh = nothingAsync, reload = nothing, fileItems }: DocsEditorProps) {
  const { me } = useApp();
  const { navigate } = useRouter();
  const notify = useNotify();
  const caps = capsFor(meta);
  const features = source.features;
  const fileRows = useMemo(() => (fileItems?.length ? [...COLLECTED.fileItems, ...fileItems] : COLLECTED.fileItems), [fileItems]);

  const rs = useConnection(source, { onRoleChanged: () => void refresh(), checkAccess: () => checkAccess(meta.id) });
  const peers = usePeers(rs.conn?.awareness ?? null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [panes, setPanes] = useState<{ left: string | null; right: string | null }>({ left: null, right: null });
  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState('editing');
  const [shareOpen, setShareOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [removeLockOpen, setRemoveLockOpen] = useState(false);
  const [preview, setPreview] = useState<VersionSummary | null>(null);
  const [restoring, setRestoring] = useState<VersionSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // The badge on the comments button is right before the pane is ever opened.
  const openComments = useOpenThreads(meta.id, features.comments && !meta.locked);

  const user = useMemo(
    () => ({
      name: me?.name ?? 'Guest',
      // A guest has no account id to hash; their client id is theirs for the visit.
      color: colorFor(me?.id ?? `guest:${rs.conn?.doc.clientID ?? 0}`),
      avatar: me?.avatarUrl ?? null
    }),
    [me, rs.conn]
  );

  const extensions = useMemo(
    () =>
      rs.conn
        ? documentExtensions({ doc: rs.conn.doc, awareness: features.presence ? rs.conn.awareness : null, user }, DOCS_MODULES)
        : null,
    [rs.conn, features.presence, user]
  );

  // The binding builds the page from the shared document in one replacement, which leaves the
  // caret at the very end: "Page 52 of 52" over a first page. A document opens at its start,
  // unless a click has already put the caret somewhere.
  const opened = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor || !rs.synced || opened.current === editor) return;
    opened.current = editor;
    if (editor.isFocused) return;
    editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)).setMeta('addToHistory', false));
  }, [editor, rs.synced]);

  const stopped = rs.stop !== null;

  // A suggestion carries its author's name, and is a Yjs update the room must take: a
  // signed-in editor or the owner, on a document with comments. Never a commenter.
  const canSuggest = features.comments && !meta.locked && caps.canEdit && !caps.trashed && !stopped && !preview && me !== null;

  // A reader cannot type, so there is nothing to switch between.
  const modes = useMemo(
    () =>
      caps.canEdit
        ? COLLECTED.modes.filter((m) => m.id !== 'suggesting' || canSuggest)
        : [{ id: 'viewing', label: caps.canComment ? 'Commenting' : 'Viewing', order: 100 }],
    [caps.canEdit, caps.canComment, canSuggest]
  );
  const activeMode = !caps.canEdit ? 'viewing' : mode === 'suggesting' && !canSuggest ? 'editing' : mode;

  // Suggesting types in the page too; `can.edit` stays Editing's, so the ribbon's
  // formatting, which cannot be suggested, is not offered there.
  const editable = caps.canEdit && !stopped && !preview && (activeMode === 'editing' || activeMode === 'suggesting');

  const can: DocsCan = {
    edit: editable && activeMode === 'editing',
    comment: features.comments && caps.canComment && !stopped && !preview,
    comments: features.comments && !meta.locked,
    suggest: canSuggest,
    share: features.sharing && caps.canShare,
    history: features.history && caps.canSeeHistory,
    lock: features.lock && caps.owner && !caps.trashed && !meta.locked,
    unlock: features.unlock && caps.owner,
    copy: features.copy && !caps.guest && !caps.restricted && !caps.trashed,
    trash: features.trash && caps.owner && !caps.trashed,
    template: features.sharing && caps.owner && !caps.trashed && !meta.locked,
    star: features.star && !caps.guest,
    rename: features.rename && caps.owner,
    create: source.kind === 'cloud' && !caps.guest,
    print: !caps.restricted
  };

  const connection: DocsContext['connection'] =
    source.kind === 'local' ? 'local' : source.kind === 'locked' ? 'locked' : stopped ? 'stopped' : liveStatus({ status: rs.status, synced: rs.synced }) === 'live' ? 'live' : rs.status === 'offline' ? 'offline' : 'connecting';

  // ── acts on the document ──────────────────────────────────────────────────

  const rename = async (title: string) => {
    const before = meta;
    // Answers in the same frame; the server's refusal puts it back.
    setMeta({ ...meta, title });
    if (source.kind === 'local') return;
    try {
      setMeta(await documents.rename(meta.id, title));
    } catch (err) {
      setMeta(before);
      notify({ text: errorText(err, 'Could not rename it.'), tone: 'danger' });
    }
  };

  const star = async () => {
    const on = !meta.starred;
    setMeta({ ...meta, starred: on });
    try {
      await documents.star(meta.id, on);
    } catch (err) {
      setMeta({ ...meta, starred: !on });
      notify({ text: errorText(err, 'Could not change the star.'), tone: 'danger' });
    }
  };

  const trash = async () => {
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
  };

  const copy = async () => {
    try {
      const made = await documents.copy(meta.id);
      navigate(docPath(made.kind, made.id));
      notify({ text: `Made “${made.title}”.` });
    } catch (err) {
      notify({ text: errorText(err, 'Could not make a copy.'), tone: 'danger' });
    }
  };

  const newDocument = async (kind: DocKind = 'docs') => {
    try {
      const made = await documents.create({ kind });
      navigate(docPath(made.kind, made.id));
    } catch (err) {
      notify({ text: errorText(err, 'Could not make that document.'), tone: 'danger' });
    }
  };

  const restoreFromTrash = async () => {
    try {
      await documents.restoreFromTrash(meta.id);
      // The room let this socket in read-only while the document was in the
      // trash, so start over and be let in as an editor.
      reload();
    } catch (err) {
      notify({ text: errorText(err, 'Could not restore it.'), tone: 'danger' });
    }
  };

  const restoreVersion = async (version: VersionSummary) => {
    setRestoreBusy(true);
    try {
      const res = await versionsApi.restore(meta.id, version.id);
      setRestoring(null);
      if (!res.ok) {
        notify({ text: 'That version could not be restored.', tone: 'danger' });
        return;
      }
      setPreview(null);
      setHistoryKey((k) => k + 1);
      notify({
        text: 'Restored.',
        ...(res.undoVersionId
          ? {
              action: {
                label: 'Undo',
                run: () =>
                  void versionsApi
                    .restore(meta.id, res.undoVersionId!)
                    .then(() => setHistoryKey((k) => k + 1))
                    .catch((e: unknown) => notify({ text: errorText(e, 'Could not undo that.'), tone: 'danger' }))
              }
            }
          : {})
      });
    } catch (err) {
      setRestoring(null);
      notify({ text: errorText(err, 'Could not restore that version.'), tone: 'danger' });
    } finally {
      setRestoreBusy(false);
    }
  };

  // ── panes ─────────────────────────────────────────────────────────────────

  const builtinPanes: PaneSpec<DocsContext>[] = [
    {
      id: 'history',
      side: 'right',
      title: 'Version history',
      width: 360,
      visible: (c) => c.can.history,
      render: () => (
        <HistoryPanel documentId={meta.id} selectedId={preview?.id ?? null} refreshKey={historyKey} onSelect={setPreview} />
      )
    }
  ];
  const allPanes = [...builtinPanes, ...COLLECTED.panes];

  const paneApi: PaneApi = {
    isOpen: (id) => panes.left === id || panes.right === id,
    open: (id) => {
      const spec = allPanes.find((p) => p.id === id);
      if (spec) setPanes((p) => ({ ...p, [spec.side]: id }));
    },
    close: (id) => setPanes((p) => ({ left: p.left === id ? null : p.left, right: p.right === id ? null : p.right })),
    toggle: (id) => {
      const spec = allPanes.find((p) => p.id === id);
      if (!spec) return;
      setPanes((p) => ({ ...p, [spec.side]: p[spec.side] === id ? null : id }));
    }
  };

  const closePane = (id: string) => {
    paneApi.close(id);
    if (id === 'history') setPreview(null);
  };

  // ── the context every module sees ─────────────────────────────────────────

  const openShare = (from?: HTMLElement | null) => {
    if (source.kind === 'locked') {
      setShareOpen(true);
      return;
    }
    if (from) {
      // The dialog grows out of the button where the browser can morph it.
      void viewTransition(() => flushSync(() => setShareOpen(true)), {
        from,
        to: () => document.querySelector<HTMLElement>('[data-morph-target]')
      });
    } else setShareOpen(true);
  };

  const actions: DocsActions = {
    share: openShare,
    lock: () => setLockOpen(true),
    removePassword: () => setRemoveLockOpen(true),
    copy: () => void copy(),
    trash: () => void trash(),
    newDocument: (kind) => void newDocument(kind),
    openHome: () => navigate('/'),
    print: () => window.print(),
    startComment: () => void startComment(ctx),
    focusTitle: () => document.querySelector<HTMLInputElement>('input.oa-hd-title-input')?.focus(),
    focusEditor: () => void editor?.commands.focus()
  };

  const ctx: DocsContext = {
    editor,
    source,
    features,
    meta,
    caps,
    can,
    connection,
    mode: activeMode,
    setMode,
    panes: paneApi,
    actions,
    notify
  };

  // The right-click menu over a link, a picture or a table: each module says what goes in it.
  const contextMenu = useDocsContextMenu(ctx, COLLECTED.context);

  // The ribbon re-reads what its controls show when the selection moves, at once,
  // and a beat after typing stops: a keystroke must not pay for thirty buttons.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!editor) return () => undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean; storedMarksSet: boolean } }) => {
        if (transaction.docChanged) {
          clearTimeout(timer);
          timer = setTimeout(cb, 150);
        } else if (transaction.selectionSet || transaction.storedMarksSet) cb();
      };
      editor.on('transaction', onTransaction);
      return () => {
        editor.off('transaction', onTransaction);
        clearTimeout(timer);
      };
    },
    [editor]
  );

  // ── the shell ─────────────────────────────────────────────────────────────

  const paneOf = (side: 'left' | 'right'): ShellPane | null => {
    const id = panes[side];
    const spec = id ? allPanes.find((p) => p.id === id && p.side === side && (p.visible?.(ctx) ?? true)) : undefined;
    if (!spec) return null;
    return {
      id: spec.id,
      title: spec.title,
      ...(spec.label ? { label: spec.label } : {}),
      width: spec.width,
      node: spec.render(ctx, () => closePane(spec.id)),
      onClose: () => closePane(spec.id)
    };
  };

  const saveLabel = (): { label: string; tone?: 'warn' } | null => {
    if (source.kind === 'local' || stopped) return null;
    if (source.kind === 'locked') {
      switch (rs.saveState) {
        case 'saved':
          return { label: 'Saved' };
        case 'saving':
          return { label: 'Saving' };
        case 'dirty':
          return { label: 'Unsaved changes' };
        default:
          return { label: 'Not saved', tone: 'warn' };
      }
    }
    return connection === 'live' ? { label: 'Saved' } : connection === 'offline' ? { label: 'Offline', tone: 'warn' } : { label: 'Connecting' };
  };
  const save = saveLabel();

  const note = caps.trashed ? 'In the trash' : meta.role === 'viewer' ? 'View only' : meta.role === 'commenter' ? 'Comment only' : null;

  const self = me ? [{ clientId: 0, name: me.name, color: colorFor(me.id), avatar: avatarSrc(me.avatarUrl), self: true, tabs: 1 }] : [];

  const sharesLocked = source.kind === 'locked' && caps.owner;

  const notices = (
    <div className="oa-notices">
      {caps.trashed && (
        <Banner
          action={
            caps.owner ? (
              <Button variant="secondary" size="sm" onClick={() => void restoreFromTrash()}>
                Restore
              </Button>
            ) : undefined
          }
        >
          This document is in the trash.
        </Banner>
      )}
      {rs.stop && (
        <Banner
          tone="danger"
          action={
            rs.stop === 'signed-out' ? (
              <SignInButton />
            ) : rs.stop === 'revoked' || rs.stop === 'no-access' ? (
              <HomeButton />
            ) : (
              <Button variant="secondary" size="sm" onClick={reload}>
                Reload
              </Button>
            )
          }
        >
          {STOP_TEXT[rs.stop]}
        </Banner>
      )}
      {rs.notice && !rs.stop && <Banner tone="warning">This document is nearly at its size limit.</Banner>}
      {source.kind === 'locked' && rs.saveState === 'conflict' && (
        <Banner
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reload
            </Button>
          }
        >
          This document was saved somewhere else. Reload to keep editing.
        </Banner>
      )}
      {source.kind === 'locked' && rs.saveState === 'error' && (
        <Banner tone="warning">Your last change is not saved yet. Trying again.</Banner>
      )}
      {preview && (
        <Banner
          action={
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
                Back to current
              </Button>
              <Button variant="primary" size="sm" onClick={() => setRestoring(preview)}>
                Restore this version
              </Button>
            </span>
          }
        >
          Viewing {versionTitle(preview)}, {whenPhrase(preview.createdAt, Math.floor(Date.now() / 1000))}.
        </Banner>
      )}
    </div>
  );

  return (
    // The dialogs sit beside the shell, not in it, and are still this app's: they take its colour from here.
    <AppKindProvider value={meta.kind}>
      <EditorShell
        kind={meta.kind}
        header={{
          title: meta.title,
          titleEditable: can.rename,
          onRename: (t) => void rename(t),
          badgeIcon: fileTextIcon,
          locked: meta.locked,
          note,
          star: can.star ? { on: meta.starred, onToggle: () => void star() } : null,
          save: save
            ? {
                label: save.label,
                ...(save.tone ? { tone: save.tone } : {}),
                ...(can.history ? { onClick: () => paneApi.toggle('history'), title: 'Version history' } : {})
              }
            : null,
          people: features.presence ? peers : source.kind === 'locked' ? self : [],
          comments: can.comments
            ? { count: openComments, active: paneApi.isOpen('comments'), onClick: () => paneApi.toggle('comments') }
            : null,
          share: can.share || sharesLocked ? { onClick: (button) => actions.share(button) } : null
        }}
        search={<CommandSearch commands={COLLECTED.commands} ctx={ctx} onRan={() => editor?.commands.focus()} />}
        ribbon={{
          tabs: DOCS_TABS,
          groups: COLLECTED.ribbon,
          ctx,
          active: tab,
          onActive: setTab,
          fileMenu: <FileMenu items={fileRows} ctx={ctx} />,
          modeSlot: <EditingModeMenu modes={modes} mode={activeMode} onMode={setMode} />,
          subscribe
        }}
        left={paneOf('left')}
        right={paneOf('right')}
        statusLeft={statusFor(COLLECTED.statusItems, 'left', ctx).map((i) => (
          <span key={i.id} style={{ display: 'contents' }}>
            {i.render(ctx)}
          </span>
        ))}
        statusRight={statusFor(COLLECTED.statusItems, 'right', ctx).map((i) => (
          <span key={i.id} style={{ display: 'contents' }}>
            {i.render(ctx)}
          </span>
        ))}
        notices={notices}
      >
        <Page>
          {preview ? (
            <Preview documentId={meta.id} version={preview} />
          ) : extensions ? (
            <PageEditor
              extensions={extensions}
              editable={editable}
              restricted={caps.restricted}
              hint={rs.synced}
              onEditor={setEditor}
            />
          ) : null}
        </Page>
      </EditorShell>

      {contextMenu}

      {shareOpen &&
        (source.kind === 'locked' ? (
          <NoShareDialog
            onClose={() => setShareOpen(false)}
            onRemoveLock={() => {
              setShareOpen(false);
              setRemoveLockOpen(true);
            }}
          />
        ) : (
          <ShareDialog meta={meta} owner={caps.owner} onClose={() => setShareOpen(false)} onChanged={() => void refresh()} />
        ))}

      {lockOpen && (
        <LockDialog
          meta={meta}
          getState={() => (rs.conn && rs.synced ? Y.encodeStateAsUpdate(rs.conn.doc) : null)}
          onLocked={() => {
            setLockOpen(false);
            reload();
          }}
          onClose={() => setLockOpen(false)}
        />
      )}

      {removeLockOpen && rs.conn?.prepare && (
        <RemovePasswordDialog
          meta={meta}
          prepare={rs.conn.prepare}
          onDone={() => {
            setRemoveLockOpen(false);
            reload();
          }}
          onClose={() => setRemoveLockOpen(false)}
        />
      )}

      {restoring && (
        <RestoreDialog
          version={restoring}
          busy={restoreBusy}
          onConfirm={() => void restoreVersion(restoring)}
          onClose={() => setRestoring(null)}
        />
      )}
    </AppKindProvider>
  );
}
