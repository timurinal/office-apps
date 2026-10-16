/**
 * A presentation, on whatever source it comes from.
 *
 * The page owns what has to agree with everything else on the screen: the connection and the
 * model on it, what is chosen, the zoom, the modules' contributions, the header that shows who is
 * here, and the panes and dialogs that act on the deck. They hang off it because a restore, a
 * revoked share or a deck in the trash changes all of them at once.
 *
 * ── What re-renders it, and what does not ───────────────────────────────────
 * The order of the slides, the design, what is chosen, the people, the room's state. A keystroke
 * changes none of them: the canvas and the rail each follow the model themselves (useSlideModel.ts),
 * the rail a moment later and in a transition (editor/Rail.tsx), and the ribbon re-reads its
 * controls from the model, the selection and the caret on its own subscription.
 *
 * ── Previewing a version ────────────────────────────────────────────────────
 * Choosing a version in the history pane shows it in place of the live deck: a read-only model of
 * its own, with its own selection, and the context's `model` is that one. The live deck carries on
 * underneath with the selection it had, and is shown again by "Back to current". A restore is the
 * room's work, as it is for a document.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { flushSync } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { DocumentMeta, VersionSummary } from '@shared/api';
import { errorText } from '../api';
import { versions as versionsApi } from '../client';
import { capsFor } from '../core/caps';
import { colorFor } from '../core/color';
import { Button } from '../core/controls';
import { HomeButton, SignInButton } from '../core/EditorFrame';
import { HistoryPanel } from '../core/HistoryPanel';
import { presentationChartIcon, sidebarSimpleIcon } from '../core/icons';
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
import type { DocumentSource } from '../docs/source';
import { useConnection, usePeers } from '../docs/useConnection';
import { DUR } from '../motion';
import { usePresence } from '../motion/presence';
import { viewTransition } from '../motion/viewTransition';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { useRouter } from '../router';
import { matches } from '../sheets/keys';
import { useDocumentActions } from '../sheets/useDocumentActions';
import { useApp } from '../state';
import { newSlide } from './editor/actions';
import { Canvas, type EditStart } from './editor/Canvas';
import { copyPayload, encodeClip, pasteFrom, PICTURES_LEFT_OUT, removeCopied, SLIDES_MIME, writeEvent, type ClipTarget } from './editor/clipboard';
import { createTextFormat } from './editor/format';
import { cellEditor, onCellActivity } from './modules/insert/tables';
import { Notes } from './editor/Notes';
import { publish, stateFor, usePeerViews } from './editor/presence';
import { Rail } from './editor/Rail';
import { SelectionStore, useSelection, type DeckLookup, type Selection } from './editor/selection';
import { edgesFor, SNAP_PX, snapBox } from './editor/snap';
import { boundsOf, type Box, type ModelNotice, type SlideModel } from './model/model';
import type { SlideJSON } from './model/deck';
import { collect } from './modules/collect';
import { SLIDES_MODULES } from './modules';
import {
  SLIDES_TABS,
  type CanvasDrag,
  type CanvasFrame,
  type Connection,
  type PaneApi,
  type SlidesActions,
  type SlidesCan,
  type SlidesContext,
  type SlidesKey,
  type SnapResult
} from './modules/types';
import { PresentMenu } from './present';
import { documentAssets, SlideAssets } from './render';
import { useDeckSlice, useOrder, useSlideModel, useVersionModel } from './useSlideModel';
import './editor/editor.css';

const STOP_TEXT: Record<StopReason, string> = {
  revoked: 'You no longer have access to this presentation.',
  'no-access': 'You can no longer open this presentation.',
  'signed-out': 'Your session ended. Sign in to keep editing.',
  'too-large': 'This presentation is too large to keep editing. Your last change was not saved.',
  protocol: 'This presentation could not be kept in sync.'
};

const COLLECTED = collect(SLIDES_MODULES);

/** Normal first, then each module's. */
const VIEWS: SlidesContext['views'] = [
  { id: 'normal', label: 'Normal', icon: sidebarSimpleIcon },
  ...COLLECTED.views.map((v) => ({ id: v.id, label: v.label, ...(v.icon ? { icon: v.icon } : {}) }))
];

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
/** A slide 1280 px wide is 100%: 1920 slide px at 100% is 1280 screen px. */
const ZOOM_PER_SCALE = 150;

/** Fields and floating surfaces own their own keys, as in Sheets (sheets/keys.ts). */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], .oa-popover';
/** Where a copy, a cut or a paste is the field's own. */
const OWN_CLIPBOARD = 'input, textarea, [contenteditable="true"]';

const inside = (target: EventTarget | null, selector: string): boolean => target instanceof Element && target.closest(selector) !== null;

export interface SlidesEditorProps {
  source: DocumentSource;
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

const lookup = (m: SlideModel): DeckLookup => ({ order: () => m.order(), hasElement: (s, e) => m.element(s, e) !== null });

/** A selection for a model, already on its first slide. */
function storeFor(m: SlideModel | null): SelectionStore {
  const s = new SelectionStore();
  if (m) s.repair(lookup(m));
  return s;
}

/** Keeps a selection on what the deck still has, and brings back the one an undone step was made with. */
function useRepair(model: SlideModel | null, selection: SelectionStore): void {
  useEffect(() => {
    if (!model) return;
    const repair = () => selection.repair(lookup(model));
    repair();
    return model.subscribe(repair);
  }, [model, selection]);
}

/** The model's refusals are said once, as a toast. */
const toastFor = (n: ModelNotice): { text: string; tone?: 'danger' } => (n.kind === 'read-only' ? { text: n.message } : { text: n.message, tone: 'danger' });

/** One listener on the document for the modules' keys, reading the latest context when a key arrives. */
function useSlidesKeys(keys: readonly SlidesKey[], ctx: React.MutableRefObject<SlidesContext | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The canvas or the rail has answered it already, or an input method is composing.
      if (e.defaultPrevented || e.isComposing) return;
      if (inside(e.target, OWN_KEYS)) return;
      const c = ctx.current;
      if (!c) return;
      const key = keys.find((k) => matches(k.keys, e) && (k.when?.(c) ?? true));
      if (key && key.run(c) !== false) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keys, ctx]);
}

export function SlidesEditor({ source, meta, setMeta = nothing, refresh = nothingAsync, reload = nothing }: SlidesEditorProps) {
  const { me } = useApp();
  const { navigate } = useRouter();
  const notify = useNotify();
  const caps = capsFor(meta);
  const features = source.features;
  const act = useDocumentActions(meta, setMeta, reload, source.kind === 'local');

  const [tab, setTab] = useState('home');
  const [mode, setMode] = useState('editing');
  const [view, setView] = useState('normal');
  const [panes, setPanes] = useState<{ left: string | null; right: string | null }>({ left: null, right: null });
  const [zoom, setZoomValue] = useState(100);
  const [fit, setFit] = useState(true);
  const [deskSize, setDeskSize] = useState({ w: 0, h: 0 });
  const [notesShown, setNotesShown] = useState(true);
  const [notesFocused, setNotesFocused] = useState(false);
  const [show, setShow] = useState<{ from: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [preview, setPreview] = useState<VersionSummary | null>(null);
  const [restoring, setRestoring] = useState<VersionSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // ── the deck ──────────────────────────────────────────────────────────────

  const rs = useConnection(source, { onRoleChanged: () => void refresh(), checkAccess: () => checkAccess(meta.id) });
  const stopped = rs.stop;
  const awareness = features.presence ? (rs.conn?.awareness ?? null) : null;
  const peers = usePeers(awareness);

  // A reader's model refuses every step and says so, so no button or key has to remember it.
  const live = useSlideModel(rs.conn, !(caps.canEdit && mode === 'editing') || stopped !== null);
  const versionView = useVersionModel(meta.id, preview);
  const versionModel = versionView?.status === 'ready' ? versionView.model : null;
  const previewing = versionModel !== null;
  const shown = versionModel ?? live;

  // Opened once the room has sent the deck; a reconnect does not put the skeleton back.
  const [synced, setSynced] = useState(false);
  if (rs.synced && !synced) setSynced(true);
  const ready = shown !== null && (previewing || synced || source.kind !== 'cloud');

  const user = useMemo(
    () => ({
      name: me?.name ?? 'Guest',
      // A guest has no account id to hash; their client id is theirs for the visit.
      color: colorFor(me?.id ?? `guest:${rs.conn?.doc.clientID ?? 0}`)
    }),
    [me, rs.conn]
  );
  useEffect(() => {
    awareness?.setLocalStateField('user', user);
  }, [awareness, user]);

  // ── what is chosen ────────────────────────────────────────────────────────

  // The live deck keeps its selection while a version is looked at, and has it back after.
  const liveSelection = useMemo(() => storeFor(live), [live]);
  const versionSelection = useMemo(() => storeFor(versionModel), [versionModel]);
  const selection = previewing ? versionSelection : liveSelection;
  useRepair(live, liveSelection);
  useRepair(versionModel, versionSelection);
  const selected = useSelection(selection);

  // An undo or a redo puts back the slide and what was chosen when the step was made. A caret in
  // the text that is being undone stays there.
  useEffect(() => {
    if (!live) return;
    live.setUndoContext(() => liveSelection.get());
    const off = live.onRestore((context) => {
      const was = context as Selection | null;
      if (!was || typeof was !== 'object' || !('slides' in was)) return;
      const now = liveSelection.get();
      liveSelection.set({
        slide: was.slide,
        slides: was.slides,
        els: was.els,
        editing: now.editing !== null && now.editing === was.editing ? now.editing : null
      });
      liveSelection.repair(lookup(live));
    });
    return () => {
      live.setUndoContext(null);
      off();
    };
  }, [live, liveSelection]);

  // Other people see where this person is: the slide, what is chosen, the text with the caret.
  useEffect(() => {
    if (!awareness) return;
    const push = () => publish(awareness, stateFor(liveSelection.get(), notesFocused));
    push();
    return liveSelection.subscribe(push);
  }, [awareness, liveSelection, notesFocused]);
  const peerViews = usePeerViews(awareness);
  const shownPeers = previewing ? NO_PEERS : peerViews;

  const order = useOrder(shown);
  const design = useDeckSlice(shown, (m) => m.design(), (c) => c.design);
  const slideId = selected.slide;
  const slideIndex = slideId ? order.indexOf(slideId) : -1;

  // The model's refusals are said once, as a toast; the page's own banners say the rest.
  useEffect(() => {
    if (!shown) return;
    return shown.onNotice((n) => notify(toastFor(n)));
  }, [shown, notify]);

  // ── what this person may do ───────────────────────────────────────────────

  const editable = caps.canEdit && !stopped && !previewing && ready && mode === 'editing';
  // A reader has nothing to switch between.
  const modes = useMemo(() => (caps.canEdit ? COLLECTED.modes : [{ id: 'viewing', label: 'Viewing', order: 100 }]), [caps.canEdit]);
  const activeMode = !caps.canEdit ? 'viewing' : mode;

  const can: SlidesCan = {
    edit: editable,
    share: features.sharing && caps.canShare,
    history: features.history && caps.canSeeHistory,
    copy: features.copy && !caps.guest && !caps.restricted && !caps.trashed,
    trash: features.trash && caps.owner && !caps.trashed,
    star: features.star && !caps.guest,
    rename: features.rename && caps.owner,
    create: source.kind === 'cloud' && !caps.guest,
    download: !caps.restricted,
    present: COLLECTED.presenter !== null,
    template: features.sharing && caps.owner && !caps.trashed && !meta.locked
  };

  const connection: Connection =
    source.kind !== 'cloud'
      ? 'local'
      : stopped
        ? 'stopped'
        : liveStatus({ status: rs.status, synced: rs.synced }) === 'live'
          ? 'live'
          : rs.status === 'offline'
            ? 'offline'
            : 'connecting';

  // ── the zoom ──────────────────────────────────────────────────────────────

  const W = shown?.width ?? 1920;
  const H = shown && design ? shown.height : 1080;
  // Fit leaves 24 px each side and 12 px above and below the slide.
  const fitScale = deskSize.w > 0 ? Math.max(0.05, Math.min((deskSize.w - 48) / W, (deskSize.h - 24) / H)) : 0.5;
  const scale = fit ? fitScale : zoom / ZOOM_PER_SCALE;
  const zoomShown = fit ? Math.round(fitScale * ZOOM_PER_SCALE) : zoom;
  const setZoom = useCallback((value: number | 'fit') => {
    if (value === 'fit') {
      setFit(true);
      return;
    }
    setFit(false);
    setZoomValue(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value))));
  }, []);
  const onDeskSize = useCallback((w: number, h: number) => setDeskSize((d) => (d.w === w && d.h === h ? d : { w, h })), []);

  // ── panes ─────────────────────────────────────────────────────────────────

  const builtinPanes: PaneSpec<SlidesContext>[] = [
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

  // ── the keyboard's places ─────────────────────────────────────────────────

  const page = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement | null>(null);
  const editStart = useRef<EditStart | null>(null);
  const editor = useRef<Editor | null>(null);

  const focusCanvas = useCallback(() => {
    const ed = editor.current;
    if (ed && !ed.isDestroyed) ed.commands.focus();
    else desk.current?.focus({ preventScroll: true });
  }, []);
  const focusRail = useCallback(() => page.current?.querySelector<HTMLElement>('.sl-rail')?.focus({ preventScroll: true }), []);

  // The caret moving or the text changing: the ribbon re-reads what its controls show.
  const activity = useMemo(() => {
    const listeners = new Set<() => void>();
    return {
      emit: () => listeners.forEach((l) => l()),
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      }
    };
  }, []);
  const onEditor = useCallback(
    (ed: Editor | null) => {
      editor.current = ed;
      activity.emit();
    },
    [activity]
  );

  const shownRef = useRef(shown);
  shownRef.current = shown;
  // A table cell's editor is made by its canvas layer (modules/insert/tables.ts), not here: the ribbon formats through either.
  const text = useMemo(() => createTextFormat({ model: () => shownRef.current!, selection, editor: () => (editor.current && !editor.current.isDestroyed ? editor.current : cellEditor()) }), [selection]);
  useEffect(() => onCellActivity(activity.emit), [activity]);

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

  const actions: SlidesActions = {
    share: openShare,
    copy: () => void act.copy(),
    trash: () => void act.trash(),
    newDocument: (kind) => void act.newDocument(kind),
    openHome: () => navigate('/'),
    focusTitle: () => document.querySelector<HTMLInputElement>('input.oa-hd-title-input')?.focus(),
    focusCanvas,
    focusRail,
    focusPalette: () => {
      const input = document.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="Search or run a command"]');
      input?.focus();
      input?.select();
    }
  };

  // A key that would edit, on a page that cannot: a reader's, or Viewing mode. A preview has its own notice.
  const onReadOnlyEdit = () => {
    if (previewing) return;
    notify({ text: caps.canEdit ? 'This presentation is in Viewing mode.' : 'You can view this presentation, not edit it.' });
  };

  const present = (from: number) => {
    if (COLLECTED.presenter && order.length) setShow({ from: Math.max(0, Math.min(order.length - 1, from)) });
  };

  const ctx: SlidesContext | null =
    shown && design
      ? {
          model: shown,
          source,
          features,
          meta,
          caps,
          can,
          connection,
          design,
          slideId,
          slideIndex,
          selected,
          selection,
          select: {
            slide: (id, extend) => selection.showSlide(id, shown.order(), extend),
            elements: (ids) => selection.set({ els: ids, editing: null, focus: 'canvas' }),
            editText: (elId, at = 'end') => {
              editStart.current = { el: elId, start: at };
              selection.set({ els: [elId], editing: elId, focus: 'canvas' });
            },
            clear: () => selection.set({ els: [], editing: null })
          },
          text,
          mode: activeMode,
          setMode,
          zoom: zoomShown,
          fit,
          setZoom,
          view,
          setView,
          views: VIEWS,
          notes: { shown: notesShown, setShown: setNotesShown },
          panes: paneApi,
          actions,
          present,
          notify
        }
      : null;

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // The ribbon re-reads its controls when the deck changes, the selection moves or the caret does.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!shown) return () => undefined;
      const a = shown.subscribe(cb);
      const b = selection.subscribe(cb);
      const c = activity.subscribe(cb);
      return () => {
        a();
        b();
        c();
      };
    },
    [shown, selection, activity]
  );

  useSlidesKeys(COLLECTED.keys, ctxRef);

  // ── the canvas's hooks into the modules ───────────────────────────────────

  // The modules' snap rules first, then core's: the slide's edges and centre, and the other objects'.
  const snap = useCallback((box: Box, drag: CanvasDrag, slide: SlideJSON): SnapResult | null => {
    const c = ctxRef.current;
    if (!c) return null;
    const width = c.model.width;
    const height = c.model.height;
    const s = scaleRef.current;
    for (const rule of COLLECTED.snaps) {
      const r = rule(box, { ctx: c, slide, drag, width, height, scale: s });
      if (r) return r;
    }
    const others = slide.elements.filter((e) => !drag.ids.includes(e.id ?? '')).map(boundsOf);
    return snapBox(box, others, width, height, SNAP_PX / s, edgesFor(drag.kind === 'resize' ? 'resize' : 'move', drag.handle));
  }, []);

  const layers = useCallback((frame: CanvasFrame) => {
    const c = ctxRef.current;
    if (!c || !COLLECTED.canvas.length) return null;
    return COLLECTED.canvas.map((l) => <Fragment key={l.id}>{l.render(c, frame)}</Fragment>);
  }, []);

  const onNewSlide = useCallback(() => {
    if (!shownRef.current) return;
    newSlide({ model: shownRef.current, selection });
  }, [selection]);

  // ── the clipboard ─────────────────────────────────────────────────────────

  const clipTarget = (): ClipTarget | null => (shown ? { model: shown, selection, doc: meta.id } : null);

  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    if (inside(e.target, OWN_CLIPBOARD)) return;
    const t = clipTarget();
    const payload = t ? copyPayload(t) : null;
    if (!t || !payload) return;
    e.preventDefault();
    writeEvent(e.clipboardData, encodeClip(payload));
    if (cut && can.edit) removeCopied(t, payload.kind);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (inside(e.target, OWN_CLIPBOARD)) return;
    const t = clipTarget();
    if (!t || !can.edit) return;
    e.preventDefault();
    const data = e.clipboardData;
    const r = pasteFrom(t, { json: data.getData(SLIDES_MIME), html: data.getData('text/html'), text: data.getData('text/plain') });
    if (r?.droppedPictures) notify({ text: PICTURES_LEFT_OUT });
  };

  // A reader who may not copy gets neither the keys nor the menu.
  const stopCopy = caps.restricted
    ? (e: React.ClipboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;

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
      // The room replaces the deck and the live model follows it.
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

  const assets = useMemo(() => documentAssets(meta.id), [meta.id]);

  // The deck that has not come yet is drawn as its outline, which fades off it.
  const loading = usePresence(!ready, DUR.base);

  if (!ctx) return <DocumentSkeleton kind="slides" />;

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
    if (source.kind !== 'cloud' || stopped) return null;
    if (connection === 'offline') return { label: 'Offline', tone: 'warn' };
    if (connection === 'connecting') return { label: 'Connecting' };
    return { label: 'Saved' };
  })();

  const note = caps.trashed ? 'In the trash' : !caps.canEdit ? 'View only' : null;

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
          This presentation is in the trash.
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
      {rs.notice && !stopped && <Banner tone="warning">This presentation is nearly at its size limit.</Banner>}
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
          {previewing ? `Viewing ${versionTitle(preview)}, ${whenPhrase(preview.createdAt, Math.floor(Date.now() / 1000))}.` : 'Opening that version.'}
        </Banner>
      )}
    </div>
  );

  const moduleView = view === 'normal' ? null : COLLECTED.views.find((v) => v.id === view);
  const theme = ctx.design.theme;

  return (
    // The dialogs sit beside the shell, not in it, and are still this app's: they take its colour from here.
    <AppKindProvider value="slides">
      <SlideAssets.Provider value={assets}>
        <EditorShell
          kind="slides"
          bleed
          zoom={{ value: zoomShown, onChange: (v) => setZoom(v) }}
          header={{
            title: meta.title,
            titleEditable: can.rename,
            onRename: (t) => void act.rename(t),
            badgeIcon: presentationChartIcon,
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
            // Comments are not built for Slides.
            comments: null,
            share: can.share ? { onClick: (button) => actions.share(button) } : null,
            actions: can.present ? <PresentMenu ctx={ctx} disabled={!order.length} /> : null
          }}
          search={<CommandSearch commands={COLLECTED.commands} ctx={ctx} onRan={() => document.activeElement === document.body && focusCanvas()} />}
          ribbon={{
            tabs: SLIDES_TABS,
            groups: COLLECTED.ribbon,
            ctx,
            active: tab,
            onActive: setTab,
            fileMenu: <FileMenu items={COLLECTED.fileItems} ctx={ctx} />,
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
          <div
            ref={page}
            className="sl-page"
            data-doc-page="true"
            onCopyCapture={stopCopy}
            onCutCapture={stopCopy}
            onContextMenu={caps.restricted ? (e) => e.preventDefault() : undefined}
          >
            {ready && !moduleView && (
              <div className="sl-normal" onCopy={(e) => onCopy(e, false)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}>
                <Rail model={ctx.model} selection={selection} editable={can.edit} peers={shownPeers} focusCanvas={focusCanvas} />
                <div className="sl-main">
                  <Canvas
                    model={ctx.model}
                    selection={selection}
                    editable={can.edit}
                    scale={scale}
                    fit={fit}
                    peers={shownPeers}
                    awareness={previewing ? null : awareness}
                    desk={desk}
                    editStart={editStart}
                    onDeskSize={onDeskSize}
                    snap={snap}
                    layers={layers}
                    onEditor={onEditor}
                    onActivity={activity.emit}
                    onNewSlide={onNewSlide}
                    onReadOnlyEdit={onReadOnlyEdit}
                  />
                  {notesShown && slideId && (
                    <Notes
                      model={ctx.model}
                      slideId={slideId}
                      editable={can.edit}
                      theme={theme}
                      awareness={previewing ? null : awareness}
                      width={W * scale}
                      onFocusChange={setNotesFocused}
                      onExit={focusCanvas}
                    />
                  )}
                </div>
              </div>
            )}
            {ready && moduleView && moduleView.render(ctx)}
            {loading.present && (
              <div className="sl-skel oa-fade" data-state={loading.state} aria-hidden="true">
                <div className="sl-normal">
                  <div className="oa-skel-rail">
                    <div className="oa-skel-thumb" />
                    <div className="oa-skel-thumb" />
                    <div className="oa-skel-thumb" />
                  </div>
                  <div className="oa-skel-main">
                    <div className="oa-skel-desk">
                      <div className="oa-skel-slide" />
                    </div>
                    <div className="oa-skel-notes" />
                  </div>
                </div>
              </div>
            )}
            {COLLECTED.overlays.map((o) => (
              <Fragment key={o.id}>{o.render(ctx)}</Fragment>
            ))}
            {show &&
              COLLECTED.presenter?.render(ctx, {
                from: show.from,
                close: () => {
                  setShow(null);
                  focusCanvas();
                }
              })}
          </div>
        </EditorShell>

        {shareOpen && <ShareDialog meta={meta} owner={caps.owner} onClose={() => setShareOpen(false)} onChanged={() => void refresh()} />}

        {restoring && (
          <RestoreDialog version={restoring} noun="presentation" busy={restoreBusy} onConfirm={() => void restoreVersion(restoring)} onClose={() => setRestoring(null)} />
        )}
      </SlideAssets.Provider>
    </AppKindProvider>
  );
}

const NO_PEERS: never[] = [];
