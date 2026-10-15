import { useEffect, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { SaveState } from '../core/savequeue';
import { peersFrom, samePeers, type Peer } from '../core/presence';
import type { RoomNotice, RoomStatus, StopReason } from './room';
import type { DocumentSource, SourceConnection } from './source';

export interface ConnectionState {
  conn: SourceConnection | null;
  status: RoomStatus;
  /** The room has sent its state and we have applied it. Until then the page may be empty. */
  synced: boolean;
  stop: StopReason | null;
  notice: RoomNotice | null;
  /** A locked document's save state. Always `saved` for a room, whose edits are the connection. */
  saveState: SaveState;
}

const FRESH: ConnectionState = { conn: null, status: 'connecting', synced: false, stop: null, notice: null, saveState: 'saved' };

/**
 * One connection to a document's source, for as long as the page is on it: a room,
 * or (on a local or locked document) the `Y.Doc` it was handed.
 *
 * The connection is made in the effect and not during render, so React's double
 * mount in development (and a route change in production) tears one down cleanly
 * instead of leaving a socket behind.
 */
export function useConnection(
  source: DocumentSource,
  hooks: {
    onRoleChanged: () => void;
    checkAccess: () => Promise<'ok' | 'no-access' | 'signed-out'>;
  }
): ConnectionState {
  const [state, setState] = useState<ConnectionState>(FRESH);
  const latest = useRef(hooks);
  latest.current = hooks;

  useEffect(() => {
    const conn = source.connect({
      onStatus: (status) => setState((s) => ({ ...s, status })),
      onSynced: (synced) => setState((s) => ({ ...s, synced })),
      onStop: (stop) => setState((s) => ({ ...s, stop })),
      onNotice: (notice) => setState((s) => ({ ...s, notice })),
      onSaveState: (saveState) => setState((s) => ({ ...s, saveState })),
      onRoleChanged: () => latest.current.onRoleChanged(),
      checkAccess: () => latest.current.checkAccess()
    });
    setState({ ...FRESH, conn });
    return () => {
      conn.destroy();
      setState((s) => (s.conn === conn ? { ...s, conn: null } : s));
    };
  }, [source]);

  return state;
}

/** The people in a room, kept current as they come and go. */
export function usePeers(awareness: Awareness | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    // The same list is the same state: a caret that moves is a change to awareness and not to who is here.
    const update = () => setPeers((prev) => {
      const next = peersFrom(awareness.getStates(), awareness.clientID);
      return samePeers(prev, next) ? prev : next;
    });
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [awareness]);

  return peers;
}
