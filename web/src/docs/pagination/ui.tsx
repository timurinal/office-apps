/**
 * What the page view draws in React: the footer's "Page 2 of 7" and its view switch, the
 * Page setup dialog, and the toolbar over a header being edited.
 *
 * A module has no slot for a panel over the page, so as core's `CoreHost` does, these ride
 * on footer items, which are always mounted and handed the current context. They read the
 * editor's `PageStore` with `useSyncExternalStore`, keyed on its version, so a keystroke
 * that moves no page boundary renders none of this.
 */

import type { Editor } from '@tiptap/core';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, Switch } from '../../core/controls';
import { fileTextIcon, globeSimpleIcon, Icon, textAlignLeftIcon, textBIcon, textItalicIcon } from '../../core/icons';
import { usePresence } from '../../motion/presence';
import { useEditorTick, useMountedEditor, usePortalRoot } from '../core/hooks';
import { textAlignCenterIcon, textAlignRightIcon } from '../core/icons';
import type { DocsContext } from '../modules/types';
import { pageStoreOf } from './extension';
import type { FieldKind } from './nodes';
import { calendarIcon, hashIcon, textTIcon } from './icons';
import type { HFState, PageStore } from './store';

const PageSetupDialog = lazy(() => import('./PageSetupDialog'));

const noSubscribe = () => () => {};
const zero = () => 0;

/** Re-render when the editor's page store changes. Null before the editor mounts. */
export function usePageStore(editor: Editor | null): PageStore | null {
  const store = pageStoreOf(editor);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? zero, zero);
  return store;
}

export function openPageSetup(editor: Editor | null): void {
  const store = pageStoreOf(editor);
  if (!store || store.dialog) return;
  store.dialog = true;
  store.emit();
}

const SYNCED: ReadonlySet<DocsContext['connection']> = new Set(['live', 'local', 'locked']);

/** "Page 2 of 7" at the left of the footer, and the dialog and toolbar it carries. */
export function PagesHost({ ctx }: { ctx: DocsContext }) {
  const editor = useMountedEditor(ctx.editor);
  const store = usePageStore(editor);
  const root = usePortalRoot(editor);

  // The paper's default may be written once the room's state is here (extension.ts).
  useLayoutEffect(() => {
    if (store) store.synced = SYNCED.has(ctx.connection);
  }, [store, ctx.connection]);

  // The title field. A rename refills the headers once typing stops, not on every key.
  const title = ctx.meta.title;
  useEffect(() => {
    if (!store || store.title === title) return;
    const first = store.title === '';
    store.title = title;
    // At open the first pass, or the check after it, reads the title anyway.
    if (first) return;
    const t = setTimeout(() => store.control?.relayout(), 400);
    return () => clearTimeout(t);
  }, [store, title]);

  if (!store || !editor) return null;
  const { paged, pageCount, caretPage } = store.info;
  return (
    <>
      {paged && (
        <span className="oa-status" role="status" aria-live="off" style={{ fontVariantNumeric: 'tabular-nums' }}>
          Page {(caretPage ?? 0) + 1} of {pageCount}
        </span>
      )}
      {store.dialog && (
        <Suspense fallback={null}>
          <PageSetupDialog
            store={store}
            onClose={() => {
              store.dialog = false;
              store.emit();
            }}
          />
        </Suspense>
      )}
      <HFToolbar store={store} root={root} />
    </>
  );
}

/** Print layout and web layout, beside the zoom. Gone on a phone, which has only web layout. */
export function ViewSwitch({ ctx }: { ctx: DocsContext }) {
  const editor = useMountedEditor(ctx.editor);
  const store = usePageStore(editor);
  if (!store || !editor || store.narrow) return null;
  const paged = store.info.paged;
  const set = (on: boolean) => {
    if (on !== paged) editor.commands.setPaged(on);
  };
  return (
    <span role="group" aria-label="View" style={{ display: 'inline-flex', gap: 2 }}>
      <button type="button" className="oa-sb" aria-pressed={paged} aria-label="Print layout" title="Print layout" onClick={() => set(true)}>
        <Icon icon={fileTextIcon} size={14} />
      </button>
      <button type="button" className="oa-sb" aria-pressed={!paged} aria-label="Web layout" title="Web layout" onClick={() => set(false)}>
        <Icon icon={globeSimpleIcon} size={14} />
      </button>
    </span>
  );
}

// ── the header and footer toolbar ───────────────────────────────────────────

const FIELDS: readonly { kind: FieldKind; label: string; icon: string }[] = [
  { kind: 'page', label: 'Page number', icon: hashIcon },
  { kind: 'pages', label: 'Page count', icon: hashIcon },
  { kind: 'date', label: 'Date', icon: calendarIcon },
  { kind: 'title', label: 'Title', icon: textTIcon }
];

const ALIGNS = [
  { to: 'left', label: 'Align left', icon: textAlignLeftIcon },
  { to: 'center', label: 'Centre', icon: textAlignCenterIcon },
  { to: 'right', label: 'Align right', icon: textAlignRightIcon }
] as const;

/** Under the banner, as the find bar is. */
function useBannerBottom(root: HTMLElement | null, active: boolean): number {
  const [top, setTop] = useState(150);
  useLayoutEffect(() => {
    if (!root || !active) return;
    const banner = root.querySelector('.oa-banner');
    const place = () => {
      const t = banner ? banner.getBoundingClientRect().bottom + 8 : 150;
      setTop((p) => (p === t ? p : t));
    };
    place();
    const ro = banner && typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (banner) ro?.observe(banner);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [root, active]);
  return top;
}

function HFToolbar({ store, root }: { store: PageStore; root: HTMLElement | null }) {
  const open = store.hf !== null;
  const { present, state } = usePresence(open);
  // What it showed, kept for the moment it takes to leave.
  const last = useRef<HFState | null>(null);
  if (store.hf) last.current = store.hf;
  const hf = last.current;
  const top = useBannerBottom(root, present);
  // Bold, italic and alignment follow the caret; typing re-reads them once it pauses.
  useEditorTick(open ? (hf?.editor ?? null) : null, open, { docs: 'later' });

  if (!root || !present || !hf) return null;
  const e = hf.editor;
  const live = open && !e.isDestroyed;
  const run = (fn: (ed: Editor) => void) => {
    if (live) fn(e);
  };
  const differentFirst = store.setup.differentFirst;
  const name = hf.kind === 'header' ? 'Header' : 'Footer';

  return createPortal(
    <div style={{ position: 'fixed', top, left: 0, right: 0, zIndex: 65, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        className="glass oa-rise"
        data-state={state}
        data-pg-hf-toolbar=""
        role="toolbar"
        aria-label={hf.variant === 'first' ? `First page ${name.toLowerCase()}` : name}
        // The header keeps the caret while its toolbar is used.
        onMouseDown={(ev) => {
          if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            store.control?.closeHeaderFooter();
          }
        }}
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          maxWidth: 'calc(100vw - 32px)',
          padding: '6px 8px',
          borderRadius: 12
        }}
      >
        <span style={{ padding: '0 6px', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
          {hf.variant === 'first' ? `First page ${name.toLowerCase()}` : name}
        </span>
        <Divider />
        {FIELDS.map((f) => (
          <Button
            key={f.kind}
            size="sm"
            variant="ghost"
            icon={f.icon}
            disabled={!live}
            onClick={() => run((ed) => ed.chain().focus().insertContent({ type: 'pageField', attrs: { kind: f.kind } }).run())}
          >
            {f.label}
          </Button>
        ))}
        <Divider />
        <IconButton icon={textBIcon} label="Bold" size="sm" active={live && e.isActive('bold')} disabled={!live} onClick={() => run((ed) => ed.chain().focus().toggleBold().run())} />
        <IconButton icon={textItalicIcon} label="Italic" size="sm" active={live && e.isActive('italic')} disabled={!live} onClick={() => run((ed) => ed.chain().focus().toggleItalic().run())} />
        {ALIGNS.map((a) => (
          <IconButton
            key={a.to}
            icon={a.icon}
            label={a.label}
            size="sm"
            active={live && (e.isActive({ textAlign: a.to }) || (a.to === 'left' && !['center', 'right', 'justify'].some((t) => e.isActive({ textAlign: t }))))}
            disabled={!live}
            onClick={() => run((ed) => ed.chain().focus().setTextAlign(a.to).run())}
          />
        ))}
        <Divider />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 6px', fontSize: 12, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
          <Switch checked={differentFirst} label="Different first page" disabled={!live} onChange={(v) => store.control?.setSetup({ differentFirst: v })} />
          Different first page
        </label>
        <Divider />
        <Button size="sm" variant="primary" onClick={() => store.control?.closeHeaderFooter()}>
          Close
        </Button>
      </div>
    </div>,
    root
  );
}

const Divider = () => <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '4px 2px', background: 'var(--bd)' }} />;
