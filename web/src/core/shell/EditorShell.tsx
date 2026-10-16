/**
 * The editor's shell: the content full-bleed, and the chrome floating over it.
 *
 *   banner    one glass panel inset 16px at the sides and 12px from the top: the
 *             header row (badge, title, star, save state, search, people, Comments,
 *             Share), the tab row, and the ribbon strip
 *   panes     glass panels on the left and right edges, below the banner
 *   footer    a glass bar inset 16px and 12px from the bottom
 *   content   the stage, which scrolls under all of it; the page centres in the
 *             space the panes leave, on the app's tinted desk
 *
 * It is one shell for Docs, Sheets and Slides. It draws what it is given (the
 * header's facts, a ribbon's groups, a pane, the status items) and holds only the
 * state that is the shell's own: which pane is on screen's edge, the zoom, whether
 * the ribbon is collapsed.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 * A pane opening changes the space the page centres in. The layout changes at once
 * and the page glides to its new centre with a transform (`useGlide`), so nothing
 * animates `padding` and the editor never reflows a frame at a time.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type { DocKind } from '@shared/api';
import { DUR } from '../../motion';
import { useEditorTheme } from '../appearance';
import { useGlide } from '../../motion/flip';
import { usePresence } from '../../motion/presence';
import { Link } from '../../router';
import { splitVisible, type Peer } from '../presence';
import { Avatar, AppKindProvider } from '../ui';
import { Button, IconButton } from '../controls';
import {
  caretDownIcon,
  chatCircleTextIcon,
  Icon,
  lockSimpleIcon,
  minusIcon,
  plusIcon,
  starFillIcon,
  starIcon,
  usersIcon,
  xIcon,
  type PhIcon
} from '../icons';
import { Ribbon, type RibbonProps } from './Ribbon';
import './shell.css';

// ── the shell's own state, for the pieces inside ────────────────────────────

interface ShellValue {
  /** The page's zoom, as a percentage. */
  zoom: number;
  setZoom: (percent: number) => void;
}
const ShellContext = createContext<ShellValue>({ zoom: 100, setZoom: () => undefined });
export const useShell = (): ShellValue => useContext(ShellContext);

export const ZOOM = { min: 50, max: 200, step: 5 } as const;

// ── the header ──────────────────────────────────────────────────────────────

export interface ShellHeader {
  title: string;
  /** The owner edits it in place; everyone else reads it. */
  titleEditable: boolean;
  onRename: (title: string) => void;
  badgeIcon: PhIcon;
  locked?: boolean;
  /** A short fact beside the title: "View only". */
  note?: string | null;
  star?: { on: boolean; onToggle: () => void } | null;
  /** "Saved", and what clicking it does (open the history). */
  save?: { label: string; tone?: 'warn'; onClick?: () => void; title?: string } | null;
  people: Peer[];
  comments?: { count: number; active: boolean; onClick: () => void } | null;
  share?: { onClick: (button: HTMLElement) => void } | null;
  /** Buttons between Comments and Share: Present in Slides. */
  actions?: React.ReactNode;
}

function Title({ header }: { header: ShellHeader }) {
  const { title, titleEditable, onRename } = header;
  const [draft, setDraft] = useState(title);
  const focused = useRef(false);

  // A rename elsewhere shows up here, unless this field is being typed in.
  useEffect(() => {
    if (!focused.current) setDraft(title);
  }, [title]);

  if (!titleEditable) {
    return (
      <h1 className="oa-hd-title oa-ellipsis" style={{ margin: 0 }}>
        {title}
      </h1>
    );
  }

  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(title);
    else if (next !== title) onRename(next);
  };

  return (
    // The input takes the width of its text: a hidden copy of the text sizes the
    // grid cell, so the star sits beside the title rather than at the end of a box.
    <span className="oa-hd-titlewrap">
      <span className="oa-hd-sizer oa-hd-title" aria-hidden="true">
        {draft || ' '}
      </span>
      <input
        aria-label="Title"
        className="oa-hd-title oa-hd-title-input"
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(title);
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

function PeerStack({ peers }: { peers: Peer[] }) {
  const { shown, hidden } = splitVisible(peers, 4);
  if (peers.length === 0) return null;
  return (
    <div aria-label="People here" className="oa-peers">
      {shown.map((p) => (
        <span key={p.clientId} className="oa-peer oa-avatar-in">
          <Avatar
            name={p.name}
            color={p.color}
            size={28}
            ring
            title={p.self ? `${p.name} (you)${p.tabs > 1 ? `, ${p.tabs} tabs` : ''}` : p.name}
          />
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="oa-peer oa-peer-more"
          title={peers
            .slice(4)
            .map((p) => p.name)
            .join(', ')}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}

function HeaderRow({ header, search }: { header: ShellHeader; search: React.ReactNode }) {
  const share = useRef<HTMLButtonElement>(null);
  return (
    <header className="oa-hd">
      <span className="oa-hd-left">
        <Link to="/" className="oa-badge" aria-label="Home" style={{ color: 'var(--app-on-solid)' }}>
          <Icon icon={header.badgeIcon} size={17} />
        </Link>
        <Title header={header} />
        {header.locked && <Icon icon={lockSimpleIcon} size={14} className="oa-hd-lock" label="Locked" />}
        {header.note && <span className="oa-hd-note hide-sm">{header.note}</span>}
        {header.star && (
          <button
            type="button"
            className="oa-hd-star"
            aria-label={header.star.on ? 'Remove the star' : 'Star'}
            aria-pressed={header.star.on}
            onClick={header.star.onToggle}
          >
            <Icon icon={header.star.on ? starFillIcon : starIcon} size={15} />
          </button>
        )}
        {header.save && (
          <button
            type="button"
            className="oa-hd-save hide-sm"
            data-tone={header.save.tone}
            title={header.save.title}
            disabled={!header.save.onClick}
            onClick={header.save.onClick}
          >
            {header.save.label}
            {header.save.onClick && <Icon icon={caretDownIcon} size={11} />}
          </button>
        )}
      </span>

      <span className="oa-hd-mid hide-sm">{search}</span>

      <span className="oa-hd-right">
        <PeerStack peers={header.people} />
        {header.comments && (
          <Button
            variant="secondary"
            icon={chatCircleTextIcon}
            className="hide-sm"
            aria-pressed={header.comments.active}
            onClick={header.comments.onClick}
          >
            Comments
            {header.comments.count > 0 && <span className="oa-count">{header.comments.count > 9 ? '9+' : header.comments.count}</span>}
          </Button>
        )}
        {header.actions}
        {header.share && (
          <Button
            ref={share}
            variant="primary"
            icon={usersIcon}
            onClick={() => share.current && header.share?.onClick(share.current)}
          >
            Share
          </Button>
        )}
      </span>
    </header>
  );
}

// ── panes ───────────────────────────────────────────────────────────────────

export interface ShellPane {
  id: string;
  title: string;
  label?: string;
  width: number;
  node: React.ReactNode;
  onClose: () => void;
}

/** A glass pane on an edge. It slides 16px in from that edge as it fades in, and out
 *  by opacity. `usePresence` holds the last pane on screen for the length of the exit. */
function PaneHost({ side, pane }: { side: 'left' | 'right'; pane: ShellPane | null }) {
  const { present, state } = usePresence(pane !== null, DUR.fast);
  const last = useRef<ShellPane | null>(pane);
  if (pane) last.current = pane;
  const shown = pane ?? last.current;
  if (!present || !shown) return null;
  return (
    <aside
      key={shown.id}
      aria-label={shown.label ?? shown.title}
      className={`oa-pane glass oa-slide-in${side === 'left' ? ' oa-slide-in-left' : ''}`}
      data-side={side}
      data-state={state}
      style={{ width: shown.width }}
    >
      <div className="oa-pane-head">
        <h2>{shown.title}</h2>
        <IconButton icon={xIcon} label={`Close ${shown.title.toLowerCase()}`} size="sm" onClick={shown.onClose} />
      </div>
      <div className="oa-pane-body">{shown.node}</div>
    </aside>
  );
}

// ── the footer ──────────────────────────────────────────────────────────────

function Zoom() {
  const { zoom, setZoom } = useShell();
  const fill = ((zoom - ZOOM.min) / (ZOOM.max - ZOOM.min)) * 100;
  return (
    <span className="oa-zoom">
      <button type="button" className="oa-sb" aria-label="Zoom out" onClick={() => setZoom(Math.max(ZOOM.min, zoom - 10))}>
        <Icon icon={minusIcon} size={12} />
      </button>
      <input
        type="range"
        aria-label="Zoom"
        min={ZOOM.min}
        max={ZOOM.max}
        step={ZOOM.step}
        value={zoom}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => setZoom(Number(e.target.value))}
      />
      <button type="button" className="oa-sb" aria-label="Zoom in" onClick={() => setZoom(Math.min(ZOOM.max, zoom + 10))}>
        <Icon icon={plusIcon} size={12} />
      </button>
      <span className="oa-zoom-pct">{zoom}%</span>
    </span>
  );
}

// ── the shell ───────────────────────────────────────────────────────────────

export interface EditorShellProps<C> {
  kind: DocKind;
  header: ShellHeader;
  /** The search-or-command box. */
  search: React.ReactNode;
  ribbon: Pick<RibbonProps<C>, 'tabs' | 'groups' | 'ctx' | 'active' | 'onActive' | 'fileMenu' | 'modeSlot' | 'subscribe'>;
  left?: ShellPane | null;
  right?: ShellPane | null;
  /** Footer, left: page and word counts, the connection. */
  statusLeft?: React.ReactNode;
  /** Footer, right, before the zoom: the view switches. */
  statusRight?: React.ReactNode;
  /** The Sheets footer carries the sheet tabs, so it is 40px tall rather than 34. */
  tallFooter?: boolean;
  /** What sits above the page: a notice that the document is in the trash. */
  notices?: React.ReactNode;
  /**
   * The banner's fourth row, under the ribbon: Sheets' formula bar. It stays when the ribbon is
   * collapsed, because it is a control and not a toolbar.
   */
  formulaRow?: React.ReactNode;
  /**
   * The content fills the space between the banner and the footer, as Sheets' grid does, instead
   * of being a page that scrolls under the chrome. A pane narrows it rather than covering it, and
   * the notices float over its top edge.
   */
  bleed?: boolean;
  /**
   * The zoom, when the editor needs it too (a View tab's buttons). Without it the shell keeps its
   * own, at 100%.
   */
  zoom?: { value: number; onChange: (percent: number) => void };
  /** An id that changes when the page's identity does, so the shell does not glide it. */
  children: React.ReactNode;
}

export function EditorShell<C>(props: EditorShellProps<C>) {
  const { kind, header, search, ribbon, left = null, right = null, statusLeft, statusRight, tallFooter, notices, formulaRow, bleed, children } = props;
  const [collapsed, setCollapsed] = useState(false);
  const [ownZoom, setOwnZoom] = useState(100);
  const zoom = props.zoom?.value ?? ownZoom;
  const setZoom = props.zoom?.onChange ?? setOwnZoom;
  const root = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLDivElement>(null);

  // The stage starts below the banner, however tall the banner is: wrapped on a
  // phone, or with the strip collapsed. The height is also state, so that the page
  // can glide to its new place when the banner changes (below), not only jump.
  const [shellTop, setShellTop] = useState(0);
  useLayoutEffect(() => {
    const el = banner.current;
    const shell = root.current;
    if (!el || !shell) return;
    const measure = () => {
      const top = el.offsetHeight + 12;
      shell.style.setProperty('--shell-top', `${top}px`);
      setShellTop(top);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The page glides when a pane changes the space it centres in, and when the banner
  // changes how far down it starts.
  const glide = useGlide<HTMLDivElement>([left?.width ?? 0, right?.width ?? 0, shellTop]);

  // Slides is the dark editor unless the reader chose Light; the others take the page's theme.
  const theme = useEditorTheme(kind);
  return (
    <AppKindProvider value={kind}>
      <ShellContext.Provider value={{ zoom, setZoom }}>
        <div
          ref={root}
          className="oa-shell"
          data-app={kind}
          {...(theme ? { 'data-theme': theme } : {})}
          style={{ ['--page-zoom' as string]: zoom / 100 }}
        >
          <div
            className={bleed ? 'oa-stage' : 'oa-stage oa-scroll'}
            data-kind={kind}
            data-bleed={bleed ? 'true' : undefined}
            style={{
              ['--pad-l' as string]: `${16 + (left ? left.width + 16 : 0)}px`,
              ['--pad-r' as string]: `${16 + (right ? right.width + 16 : 0)}px`,
              ['--bleed-l' as string]: `${left ? left.width + 24 : 0}px`,
              ['--bleed-r' as string]: `${right ? right.width + 24 : 0}px`
            }}
          >
            {bleed ? (
              <>
                <div className="oa-bleed">{children}</div>
                {notices && <div className="oa-bleed-notices">{notices}</div>}
              </>
            ) : (
              <div ref={glide} className="oa-stage-inner">
                {notices}
                {children}
              </div>
            )}
          </div>

          <div ref={banner} className="oa-banner glass" role="banner" data-collapsed={collapsed ? 'true' : undefined}>
            <HeaderRow header={header} search={search} />
            <Ribbon
              {...ribbon}
              collapsed={collapsed}
              onCollapsed={setCollapsed}
            />
            {formulaRow && <div className="oa-fbar-row">{formulaRow}</div>}
          </div>

          <PaneHost side="left" pane={left} />
          <PaneHost side="right" pane={right} />

          <footer className="oa-footer glass" data-tall={tallFooter ? 'true' : undefined}>
            <span className="oa-footer-left">{statusLeft}</span>
            <span style={{ flex: 1 }} />
            {statusRight}
            <Zoom />
          </footer>
        </div>
      </ShellContext.Provider>
    </AppKindProvider>
  );
}
