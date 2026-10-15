/**
 * `/slides/<id>?present=audience`: the audience's window. The slide and nothing else, on black.
 *
 * The same page as the editor's, which shows this instead of the editor when the address says so
 * (SlidesPage). It connects to the room as any reader does, so the deck is live here too, and it
 * is not a person in the deck: no cursor, no name in the header. With a `show` token it is the
 * other half of a presenter's view and follows it; without one it is a show of its own.
 *
 * It cannot ask for full screen when it opens (a window opened by script has had no click of its
 * own), so it says to press F, once. Escape ends the show in both windows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentMeta } from '@shared/api';
import { Button } from '../../core/controls';
import { checkAccess } from '../../core/useDocument';
import { useConnection } from '../../docs/useConnection';
import type { DocumentSource } from '../../docs/source';
import { documentAssets, SlideAssets } from '../render';
import { useDeckSlice, useSlideModel } from '../useSlideModel';
import { fullscreenAvailable, useFullscreen } from './fullscreen';
import { Live } from './Live';
import { channelName } from './protocol';
import { useShow, type ShowHandle } from './useShow';
import { useShowKeys } from './useShowKeys';
import type { SlideModel } from '../model/model';
import './present.css';

export interface AudienceWindowProps {
  source: DocumentSource;
  meta: DocumentMeta;
  /** The token naming the channel to the presenter's window, or null for a show of its own. */
  show: string | null;
  /** The slide to start on, from 0. */
  at: number;
}

const noop = (): void => undefined;
const HINT_MS = 4000;
const root = (children: React.ReactNode, ref?: React.Ref<HTMLDivElement>) => (
  <div ref={ref} className="sp-root" data-app="slides" data-theme="dark" tabIndex={-1}>
    {children}
  </div>
);

/** The shape of a slide on black: what the window is until the deck has come, and the page's loading state for it. */
export function AudienceSkeleton() {
  return root(
    <div className="sp-wait" aria-busy="true">
      <div className="oa-bone sp-skel-slide" aria-hidden="true" />
    </div>
  );
}

/** What is left when the show ended and the window could not close itself. */
function Ended({ doc }: { doc: string }) {
  return root(
    <div className="sp-wait">
      <p className="sp-wait-note" role="status">
        The slide show has ended.
      </p>
      <Button variant="secondary" onClick={() => window.location.assign(`/slides/${encodeURIComponent(doc)}`)}>
        Open the presentation
      </Button>
    </div>
  );
}

function Running({ model, doc, show: token, at, onEnded }: { model: SlideModel; doc: string; show: string | null; at: number; onEnded: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<ShowHandle | null>(null);
  // The theme and layouts are live too: somebody changing them in the editor changes this window.
  const design = useDeckSlice(model, (m) => m.design(), (c) => c.design) ?? model.design();
  const channel = useMemo(() => (token ? { name: channelName(doc, token) } : undefined), [doc, token]);
  const fullscreen = useFullscreen(el, { start: false, onEscape: () => handle.current?.end() });
  const show = useShow({ model, from: at, role: 'audience', channel, onExit: onEnded, onFullscreen: fullscreen.toggle });
  handle.current = show;
  useShowKeys(el, show);
  useEffect(() => el.current?.focus({ preventScroll: true }), []);

  const [hint, setHint] = useState<string | null>(fullscreenAvailable() ? 'Press F for full screen.' : null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(t);
  }, [hint]);

  return root(show && <Live model={model} design={design} show={show} hint={hint} />, el);
}

export function AudienceWindow({ source, meta, show, at }: AudienceWindowProps) {
  const rs = useConnection(source, { onRoleChanged: noop, checkAccess: () => checkAccess(meta.id) });
  const model = useSlideModel(rs.conn, true);
  const assets = useMemo(() => documentAssets(meta.id), [meta.id]);
  const [ended, setEnded] = useState(false);
  // Opened once the room has sent the deck: a reconnect does not put the skeleton back, or the show's place with it.
  const [synced, setSynced] = useState(false);
  if (rs.synced && !synced) setSynced(true);

  // Not a person in the deck: no cursor over the slide being edited, no avatar.
  useEffect(() => {
    rs.conn?.awareness?.setLocalState(null);
  }, [rs.conn]);

  useEffect(() => {
    document.title = meta.title;
  }, [meta.title]);

  const onEnded = useCallback(() => {
    setEnded(true);
    // A window a script opened can close itself; one opened by hand cannot, and says so.
    window.close();
  }, []);

  if (ended) return <Ended doc={meta.id} />;
  if (rs.stop) {
    return root(
      <div className="sp-wait">
        <p className="sp-wait-note" role="alert">
          You no longer have access to this presentation.
        </p>
      </div>
    );
  }
  if (!model || !synced) {
    return <AudienceSkeleton />;
  }
  return (
    <SlideAssets.Provider value={assets}>
      <Running model={model} doc={meta.id} show={show} at={at} onEnded={onEnded} />
    </SlideAssets.Provider>
  );
}
