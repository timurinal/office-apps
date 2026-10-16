/**
 * A spreadsheet, on whatever source it comes from.
 *
 * The page owns everything that has to agree with everything else on the screen: the model and
 * its room, the sheet on screen and its selection, the modules' contributions, the header that
 * shows who is here, and the panes and dialogs that act on the workbook. They hang off it
 * because a restore, a revoked share or a workbook in the trash changes all of them at once.
 *
 * It does not know where the workbook lives. `source.features` says which server features exist,
 * and each is hidden when it does not, so the desktop's local file gets the grid, the ribbon, the
 * palette and the File menu, and no sharing, history or people.
 *
 * ── What re-renders it, and what does not ───────────────────────────────────
 * Only what the page itself draws: the list of sheets, the room's vitals, the people, "Saving".
 * A cell edit, a remote step and somebody else's cursor change none of them, so none of them
 * re-renders this component or the ribbon; the grid, the formula bar and the sum in the footer
 * subscribe to the data themselves (useSheetModel.ts).
 *
 * ── Previewing a version ────────────────────────────────────────────────────
 * Choosing a version in the history pane shows it in place of the live workbook: a read-only model
 * of its own, with its own tabs and formula bar, and the context's `model` is that one. The live
 * workbook carries on underneath and is shown again by "Back to current". A restore is the room's
 * work: it replaces the structure and the cells and closes every socket, and the live model
 * reconnects to the new snapshot (shared/cells.ts, "Restore").
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { DocumentMeta, VersionSummary } from '@shared/api';
import { errorText } from '../api';
import { versions as versionsApi } from '../client';
import { capsFor } from '../core/caps';
import { colorFor } from '../core/color';
import { useContextMenu } from '../core/contextHost';
import { Button } from '../core/controls';
import { HomeButton, SignInButton } from '../core/EditorFrame';
import { HistoryPanel } from '../core/HistoryPanel';
import { tableIcon } from '../core/icons';
import { CommandSearch } from '../core/palette/CommandSearch';
import { RestoreDialog } from '../core/RestoreDialog';
import { ShareDialog } from '../core/ShareDialog';
import { EditorShell, type ShellPane } from '../core/shell/EditorShell';
import { FileMenu } from '../core/shell/FileMenu';
import { EditingModeMenu } from '../core/shell/Ribbon';
import { statusFor } from '../core/shell/registry';
import type { PaneSpec } from '../core/shell/types';
import { AppKindProvider, Banner, useNotify } from '../core/ui';
import { checkAccess } from '../core/useDocument';
import { versionTitle, whenPhrase } from '../core/versions';
import { liveStatus, type StopReason } from '../docs/room';
import { usePeers } from '../docs/useConnection';
import { DUR } from '../motion';
import { usePresence } from '../motion/presence';
import { viewTransition } from '../motion/viewTransition';
import { useApp } from '../state';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { useRouter } from '../router';
import { Grid, useGridSession } from './grid';
import { FormulaRow } from './FormulaRow';
import type { GridIntent } from './grid';
import { applyIntent, type ModelNotice, type SheetSource } from './model';
import { collect } from './modules/collect';
import { SHEETS_MODULES } from './modules';
import { SHEETS_TABS, type Connection, type PaneApi, type SheetsActions, type SheetsCan, type SheetsContext, type SheetsMenuTarget } from './modules/types';
import { darkCellsPref } from './darkCells';
import { useDocumentActions } from './useDocumentActions';
import { sameSheets, shallowEqual, useModelSlice, useSaving, useSheetModel, useVersionModel } from './useSheetModel';
import { anchorAt, followAnchor, type EditAnchor } from './editAnchor';
import { useSheetsKeys } from './keys';
import './sheets.css';

const STOP_TEXT: Record<StopReason, string> = {
  revoked: 'You no longer have access to this spreadsheet.',
  'no-access': 'You can no longer open this spreadsheet.',
  'signed-out': 'Your session ended. Sign in to keep editing.',
  'too-large': 'This spreadsheet is too large to keep editing. Your last change was not saved.',
  protocol: 'This spreadsheet could not be kept in sync.'
};

const COLLECTED = collect(SHEETS_MODULES);

/** Room kept under the last row so it can scroll clear of the footer (40px tall, 12px up, and a gap). */
const FOOTER_INSET = 64;

/** How long a sheet may take to open before the page shows how far it has got. */
const OPENING_SHOWN_AFTER_MS = 500;

export interface SheetsEditorProps {
  source: SheetSource;
  meta: DocumentMeta;
  /** Replace the meta after a change the page made (a rename, a star). */
  setMeta?: (m: DocumentMeta) => void;
  /** Ask again without blanking the page: a role changed. */
  refresh?: () => Promise<void>;
  /** Start over, with the loading state. */
  reload?: () => void;
}

const nothing = (): void => undefined;
const nothingAsync = async (): Promise<void> => undefined;

/** The notice kinds that are a refusal to say so: the others (the room's size warning) have a banner. */
const toastFor = (n: ModelNotice): { text: string; tone?: 'danger' } | null => {
  if (n.kind === 'size') return null;
  return n.kind === 'read-only' ? { text: n.message } : { text: n.message, tone: 'danger' };
};

export function SheetsEditor({ source, meta, setMeta = nothing, refresh = nothingAsync, reload = nothing }: SheetsEditorProps) {
  const { me } = useApp();
  const { navigate } = useRouter();
  const notify = useNotify();
  const caps = capsFor(meta);
  const features = source.features;
  const act = useDocumentActions(meta, setMeta, reload, source.kind === 'local');

  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState('editing');
  const [panes, setPanes] = useState<{ left: string | null; right: string | null }>({ left: null, right: null });
  const [zoom, setZoom] = useState(100);
  const [gridlines, setGridlines] = useState(true);
  const darkCells = darkCellsPref.use();
  const [shareOpen, setShareOpen] = useState(false);
  const [preview, setPreview] = useState<VersionSummary | null>(null);
  const [restoring, setRestoring] = useState<VersionSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // ── the workbook ──────────────────────────────────────────────────────────

  const user = useMemo(
    () => ({
      name: me?.name ?? 'Guest',
      // A guest has no account id to hash; a random one is theirs for the visit.
      color: colorFor(me?.id ?? `guest:${Math.random().toString(36).slice(2)}`)
    }),
    [me]
  );

  // The room refuses a reader's steps and the model says so first, so a reader's model is read only:
  // a viewer's, a commenter's, and an editor's who has chosen Viewing. That way no button or key has to
  // remember it, and the model's own notice says so if one forgets.
  const live = useSheetModel(source, {
    readOnly: !(caps.canEdit && mode === 'editing'),
    user,
    onRoleChanged: () => void refresh(),
    checkAccess: () => checkAccess(meta.id)
  });
  // The live workbook stays on screen until the version has come, and after it fails to.
  const versionView = useVersionModel(meta.id, preview);
  const previewing = versionView?.status === 'ready';
  const shown = versionView?.status === 'ready' ? versionView.model : live;

  const vitals = useModelSlice(live, (m) => {
    const s = m.status();
    return { connection: s.connection, synced: s.synced, loaded: s.loaded, progress: s.progress, stopped: s.stopped, warn: s.warn };
  }, shallowEqual);
  const stopped = vitals?.stopped ?? null;
  const saving = useSaving(live);
  const peers = usePeers(live?.awareness ?? null);
  const sheets = useModelSlice(shown, (m) => m.sheets(), sameSheets) ?? [];

  // The sheet on screen: the one chosen, or failing that (it was deleted, or hidden, or this is
  // another workbook) the first that shows.
  const [chosen, setChosen] = useState<string | null>(null);
  const visible = sheets.filter((s) => !s.hidden);
  const sheetId = (chosen && visible.some((s) => s.id === chosen) ? chosen : (visible[0]?.id ?? sheets[0]?.id)) ?? '';
  const ready = shown !== null && sheetId !== '' && (previewing || (vitals?.loaded ?? false));

  // One session for each sheet of each workbook: its selection and scroll come back with its tab.
  const workbook = previewing && preview ? `v:${preview.id}` : 'live';
  const session = useGridSession(`${workbook}:${sheetId}`);

  // ── what this person may do ───────────────────────────────────────────────

  const canEditHere = caps.canEdit && !stopped && !previewing && ready;
  const editable = canEditHere && mode === 'editing';
  // A reader has nothing to switch between.
  const modes = useMemo(
    () => (caps.canEdit ? COLLECTED.modes : [{ id: 'viewing', label: 'Viewing', order: 100 }]),
    [caps.canEdit]
  );
  const activeMode = !caps.canEdit ? 'viewing' : mode;

  const can: SheetsCan = {
    edit: editable,
    share: features.sharing && caps.canShare,
    history: features.history && caps.canSeeHistory,
    copy: features.copy && !caps.guest && !caps.restricted && !caps.trashed,
    trash: features.trash && caps.owner && !caps.trashed,
    star: features.star && !caps.guest,
    rename: features.rename && caps.owner,
    create: source.kind === 'cloud' && !caps.guest,
    download: !caps.restricted
  };

  const connection: Connection =
    source.kind === 'local'
      ? 'local'
      : stopped
        ? 'stopped'
        : vitals && liveStatus({ status: vitals.connection, synced: vitals.synced && vitals.loaded }) === 'live'
          ? 'live'
          : vitals?.connection === 'offline'
            ? 'offline'
            : 'connecting';

  // The model's refusals are said once, as a toast; the page's own banners say the rest.
  useEffect(() => {
    if (!live) return;
    return live.onNotice((n) => {
      const t = toastFor(n);
      if (t) notify(t);
    });
  }, [live, notify]);

  // ── panes ─────────────────────────────────────────────────────────────────

  const builtinPanes: PaneSpec<SheetsContext>[] = [
    {
      id: 'history',
      side: 'right',
      title: 'Version history',
      width: 360,
      visible: (c) => c.can.history,
      render: () => <HistoryPanel documentId={meta.id} selectedId={preview?.id ?? null} refreshKey={historyKey} onSelect={setPreview} />
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

  const closePane = (id: string) => paneApi.close(id);

  // A version is looked at while its pane is open; closing the pane, however it is closed, goes back to the live one.
  useEffect(() => {
    if (panes.right !== 'history') setPreview(null);
  }, [panes.right]);

  // ── the context every module sees ─────────────────────────────────────────

  const openShare = (from?: HTMLElement | null) => {
    if (from) {
      // The dialog grows out of the button where the browser can morph it.
      void viewTransition(() => flushSync(() => setShareOpen(true)), {
        from,
        to: () => document.querySelector<HTMLElement>('[data-morph-target]')
      });
    } else setShareOpen(true);
  };

  const actions: SheetsActions = {
    share: openShare,
    copy: () => void act.copy(),
    trash: () => void act.trash(),
    newDocument: (kind) => void act.newDocument(kind),
    openHome: () => navigate('/'),
    focusTitle: () => document.querySelector<HTMLInputElement>('input.oa-hd-title-input')?.focus(),
    focusGrid: () => session.focusGrid(),
    focusPalette: () => {
      const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="Search or run a command"]');
      input?.focus();
      input?.select();
    }
  };

  const showSheet = useCallback((id: string) => setChosen(id), []);

  const ctx: SheetsContext | null = shown
    ? {
        model: shown,
        source,
        features,
        meta,
        caps,
        can,
        connection,
        sheetId,
        sheets,
        data: shown.view(sheetId),
        session,
        selection: () => ({ rect: session.rect(), active: session.sel.active }),
        showSheet,
        mode: activeMode,
        setMode,
        zoom,
        setZoom,
        view: { gridlines, setGridlines },
        panes: paneApi,
        actions,
        notify
      }
    : null;

  // The grid's intents that no step answers (the filter button) are the modules', and are read at the time they arrive.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // The right-click menu over the grid: each module says what goes in it for what was clicked.
  const menu = useContextMenu<SheetsMenuTarget, SheetsContext>({
    ctx,
    hooks: COLLECTED.context,
    label: (t) => (t.kind === 'cell' ? 'Cells' : t.kind === 'col' ? 'Columns' : 'Rows'),
    returnFocus: () => session.focusGrid()
  });

  // The ribbon re-reads what its controls show when the model changes or the selection moves.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!shown) return () => undefined;
      const a = shown.subscribe(cb);
      const b = session.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    [shown, session]
  );

  useSheetsKeys(COLLECTED.keys, ctx);

  // ── acts on the version ───────────────────────────────────────────────────

  const restoreVersion = async (version: VersionSummary) => {
    setRestoreBusy(true);
    try {
      const res = await versionsApi.restore(meta.id, version.id);
      setRestoring(null);
      if (!res.ok) {
        notify({ text: 'That version could not be restored.', tone: 'danger' });
        return;
      }
      // The room closes every socket and the model reconnects to the restored workbook.
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

  // ── the grid ──────────────────────────────────────────────────────────────

  // An edit stays with the cell it began on, though others insert and delete rows around it (editAnchor.ts).
  // The anchor is kept after the edit ends, because the intent that carries its text arrives as it does.
  const anchor = useRef<EditAnchor | null>(null);
  useEffect(() => {
    if (!shown || sheetId === '') return;
    let editing = false;
    return session.subscribe(() => {
      const e = session.edit;
      if (e && !editing) anchor.current = anchorAt(shown.engine, sheetId, e.at);
      editing = e !== null;
    });
  }, [shown, sheetId, session]);

  const onIntent = useCallback(
    (intent: GridIntent) => {
      if (!shown) return;
      const next = followAnchor(shown.engine, anchor.current, sheetId, intent);
      if (!next) notify({ text: 'That cell was deleted.' });
      else if (!applyIntent(shown, sheetId, next) && ctxRef.current) {
        for (const take of COLLECTED.intents) if (take(next, ctxRef.current)) break;
      }
    },
    [shown, sheetId, notify]
  );

  // The page that has not got its cells yet is drawn over the grid, and fades off it.
  const loading = usePresence(!ready, DUR.base);

  // A sheet that takes a moment to come says how far it is. One that comes at once never shows the line: it
  // waits for the first half second, so a small sheet opening in 300 ms has nothing to flash.
  const [slowOpen, setSlowOpen] = useState(false);
  useEffect(() => {
    if (ready) {
      setSlowOpen(false);
      return;
    }
    const id = setTimeout(() => setSlowOpen(true), OPENING_SHOWN_AFTER_MS);
    return () => clearTimeout(id);
  }, [ready]);
  const opening = !ready && slowOpen ? (vitals?.progress ?? null) : null;

  if (!ctx) return <DocumentSkeleton kind="sheets" />;

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

  const save = ((): { label: string; tone?: 'warn' } | null => {
    if (source.kind === 'local' || stopped) return null;
    if (connection === 'offline') return { label: 'Offline', tone: 'warn' };
    if (connection === 'connecting') return { label: 'Connecting' };
    return { label: saving ? 'Saving' : 'Saved' };
  })();

  const note = caps.trashed ? 'In the trash' : !caps.canEdit ? 'View only' : null;
  const readOnlyMessage = caps.canEdit ? 'This spreadsheet is in Viewing mode.' : 'You can view this spreadsheet, not edit it.';

  const notices = (
    <div className="oa-notices">
      {caps.trashed && (
        <Banner
          action={
            caps.owner ? (
              <Button variant="secondary" size="sm" onClick={() => void act.restoreFromTrash()}>
                Restore
              </Button>
            ) : undefined
          }
        >
          This spreadsheet is in the trash.
        </Banner>
      )}
      {stopped && (
        <Banner
          tone="danger"
          action={
            stopped === 'signed-out' ? (
              <SignInButton />
            ) : stopped === 'revoked' || stopped === 'no-access' ? (
              <HomeButton />
            ) : (
              <Button variant="secondary" size="sm" onClick={reload}>
                Reload
              </Button>
            )
          }
        >
          {STOP_TEXT[stopped]}
        </Banner>
      )}
      {vitals?.warn && !stopped && <Banner tone="warning">This spreadsheet is nearly at its size limit.</Banner>}
      {preview && versionView?.status === 'error' && <Banner tone="danger">{versionView.message}</Banner>}
      {preview && versionView?.status !== 'error' && (
        <Banner
          action={
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
                Back to current
              </Button>
              <Button variant="primary" size="sm" disabled={!previewing} onClick={() => setRestoring(preview)}>
                Restore this version
              </Button>
            </span>
          }
        >
          {previewing
            ? `Viewing ${versionTitle(preview)}, ${whenPhrase(preview.createdAt, Math.floor(Date.now() / 1000))}.`
            : 'Opening that version.'}
        </Banner>
      )}
    </div>
  );

  const gridKey = `${workbook}:${sheetId}`;
  // A reader who may not copy gets neither the keys nor the menu.
  const stopCopy = caps.restricted
    ? (e: React.ClipboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;

  return (
    // The dialogs sit beside the shell, not in it, and are still this app's: they take its colour from here.
    <AppKindProvider value="sheets">
      <EditorShell
        kind="sheets"
        bleed
        tallFooter
        zoom={{ value: zoom, onChange: setZoom }}
        header={{
          title: meta.title,
          titleEditable: can.rename,
          onRename: (t) => void act.rename(t),
          badgeIcon: tableIcon,
          note,
          star: can.star ? { on: meta.starred, onToggle: () => void act.star() } : null,
          save: save
            ? {
                label: save.label,
                ...(save.tone ? { tone: save.tone } : {}),
                ...(can.history ? { onClick: () => paneApi.toggle('history'), title: 'Version history' } : {})
              }
            : null,
          people: features.presence ? peers : [],
          // Comments are not built for Sheets yet.
          comments: null,
          share: can.share ? { onClick: (button) => actions.share(button) } : null
        }}
        search={<CommandSearch commands={COLLECTED.commands} ctx={ctx} onRan={() => document.activeElement === document.body && actions.focusGrid()} />}
        ribbon={{
          tabs: SHEETS_TABS,
          groups: COLLECTED.ribbon,
          ctx,
          active: tab,
          onActive: setTab,
          fileMenu: <FileMenu items={COLLECTED.fileItems} ctx={ctx} />,
          modeSlot: <EditingModeMenu modes={modes} mode={activeMode} onMode={setMode} />,
          subscribe
        }}
        formulaRow={
          ready ? (
            <FormulaRow session={session} data={ctx.data} readOnly={!can.edit} />
          ) : (
            // The same height as the real bar, so the banner does not change under the grid when it arrives.
            <div className="sg-fbar" aria-hidden="true" />
          )
        }
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
        <div className="oa-sheet-page" data-doc-page="true" onCopyCapture={stopCopy} onCutCapture={stopCopy} onContextMenu={caps.restricted ? (e) => e.preventDefault() : undefined}>
          {ready && (
            <Grid
              key={gridKey}
              session={session}
              data={ctx.data}
              onIntent={onIntent}
              zoom={zoom}
              readOnly={!can.edit}
              onReadOnlyEdit={() => notify({ text: readOnlyMessage })}
              insetBottom={FOOTER_INSET}
              gridlines={gridlines}
              darkCells={darkCells}
              label={meta.title}
              onContextMenu={(target, at, from) => void menu.open(target, at, from)}
            />
          )}
          {loading.present && <div className="oa-fade oa-sheet-skel oa-skel-lines" data-state={loading.state} aria-hidden="true" />}
          {opening !== null && (
            <div className="oa-sheet-opening" role="progressbar" aria-label="Opening this spreadsheet" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(opening * 100)}>
              <span style={{ transform: `scaleX(${opening})` }} />
            </div>
          )}
          {COLLECTED.overlays.map((o) => (
            <div key={o.id} style={{ display: 'contents' }}>
              {o.render(ctx)}
            </div>
          ))}
          {menu.element}
        </div>
      </EditorShell>

      {shareOpen && <ShareDialog meta={meta} owner={caps.owner} onClose={() => setShareOpen(false)} onChanged={() => void refresh()} />}

      {restoring && (
        <RestoreDialog
          version={restoring}
          noun="spreadsheet"
          busy={restoreBusy}
          onConfirm={() => void restoreVersion(restoring)}
          onClose={() => setRestoring(null)}
        />
      )}
    </AppKindProvider>
  );
}
