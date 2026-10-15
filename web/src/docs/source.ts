/**
 * Where a Docs document comes from.
 *
 * The editor runs on either of two sources, and the desktop app needs both (local
 * files beside cloud ones): a **cloud** document is the room and
 * the API; a **local** one is a `Y.Doc` the host hands over, with no network at all
 * and nothing to share it with. A third, the **locked** document, is the local case
 * with a save queue behind it (docs/lockedSource.ts).
 *
 * `DocsEditor` takes a `DocumentSource` and asks it two things: which server
 * features exist (`features`), and for a connection (`connect`), which is a
 * `Y.Doc`, the awareness that carries other people's carets, and a way to stop.
 * Everything that needs the server (comments, sharing, history, presence, the
 * version list) is *hidden* when its feature is off, not broken: the ribbon, the
 * File menu, the palette and the header all ask `features` before they draw.
 *
 *     <DocsEditor source={cloudSource(id)} meta={meta} … />          the web
 *     <DocsEditor source={localSource({ title, doc })} meta={…} />   the desktop, offline
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { WebsocketProvider } from 'y-websocket';
import type { DocumentMeta } from '@shared/api';
import type { SaveState } from '../core/savequeue';
import { connectRoom, type RoomEvents } from './room';

export interface SourceFeatures {
  /** Threads in the database, over the API. */
  comments: boolean;
  /** The share dialog and its API. */
  sharing: boolean;
  /** The version list, naming a version, restoring one. */
  history: boolean;
  /** Other people's carets and avatars. */
  presence: boolean;
  /** Lock with a password. */
  lock: boolean;
  /** Remove a locked document's password. */
  unlock: boolean;
  trash: boolean;
  copy: boolean;
  star: boolean;
  /** The title can be changed from the page. */
  rename: boolean;
}

export const NO_FEATURES: SourceFeatures = {
  comments: false,
  sharing: false,
  history: false,
  presence: false,
  lock: false,
  unlock: false,
  trash: false,
  copy: false,
  star: false,
  rename: false
};

export const CLOUD_FEATURES: SourceFeatures = {
  comments: true,
  sharing: true,
  history: true,
  presence: true,
  lock: true,
  unlock: false,
  trash: true,
  copy: true,
  star: true,
  rename: true
};

/** The room's events, and the save queue's. */
export interface SourceEvents extends RoomEvents {
  /** A locked document's save state. Rooms do not send it. */
  onSaveState?: (state: SaveState) => void;
}

export interface SourceConnection {
  doc: Y.Doc;
  /** Null when nobody else can be here: a local file. */
  awareness: Awareness | null;
  /** Null when there is no room. */
  provider: WebsocketProvider | null;
  /** Stop listening and let go. A local document's `Y.Doc` is the host's and is not destroyed. */
  destroy: () => void;
  /** Locked only: save what is pending and give the revision and state to unlock with. */
  prepare?: () => Promise<{ rev: number; state: Uint8Array } | null>;
}

export interface DocumentSource {
  readonly kind: 'cloud' | 'local' | 'locked';
  readonly id: string;
  readonly features: SourceFeatures;
  /** Open it. Events arrive after this returns, never during. */
  connect(events: SourceEvents): SourceConnection;
}

// ── cloud ───────────────────────────────────────────────────────────────────

type Connect = typeof connectRoom;

/** The room and the API. `connect` is injectable so a test needs no socket. */
export function cloudSource(id: string, connect: Connect = connectRoom): DocumentSource {
  return {
    kind: 'cloud',
    id,
    features: CLOUD_FEATURES,
    connect: (events) => connect(id, window.location, events)
  };
}

// ── local ───────────────────────────────────────────────────────────────────

/**
 * A synthetic `DocumentMeta` for a document that has no row: the person is its owner
 * and nothing is shared. `capsFor` reads it like any other.
 */
export function localMeta(title: string, id: string): DocumentMeta {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    kind: 'docs',
    title,
    ownerId: '',
    ownerName: '',
    role: 'owner',
    locked: false,
    starred: false,
    shared: false,
    templateScope: null,
    sizeBytes: 0,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    openedAt: null,
    generalAccess: 'restricted',
    generalRole: 'viewer',
    principal: 'user',
    canDownload: true
  };
}

export interface LocalSource extends DocumentSource {
  readonly kind: 'local';
  /** The meta to hand `DocsEditor`. */
  readonly meta: DocumentMeta;
}

/**
 * A document that lives in this process: a `Y.Doc` the host opened from a file, and
 * nothing else. It works with the network off, since it never asks for one.
 *
 * The title can be changed (`rename`); everything else the server does is off.
 */
export function localSource({ title, doc, id = 'local' }: { title: string; doc: Y.Doc; id?: string }): LocalSource {
  return {
    kind: 'local',
    id,
    features: { ...NO_FEATURES, rename: true },
    meta: localMeta(title, id),
    connect(events) {
      // After the caller has stored the connection: a status set during `connect`
      // would be overwritten by the state the caller sets next.
      queueMicrotask(() => {
        events.onStatus('connected');
        events.onSynced(true);
      });
      return { doc, awareness: null, provider: null, destroy: () => undefined };
    }
  };
}
