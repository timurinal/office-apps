/**
 * The page's end of the DocumentRoom: a stock y-websocket provider, plus the
 * decisions about when to stop.
 *
 * `WebsocketProvider` connects to the room unchanged (that is the point of the
 * room speaking y-websocket's frames), and everything here is what it does not
 * decide for us.
 *
 * ── Why the page decides when to give up ────────────────────────────────────
 * The provider reconnects on any close code outside 4400-4499, which are the
 * codes it treats as final. The room's are 4001-4006, so left alone the provider
 * would reconnect after being told to stop, and send the same refused update
 * again. The room's codes mean:
 *
 *   4001 unauthorized  the room could not tell who this was. Ask the API why.
 *   4002 protocol      the room refused a frame. A client bug; sending again
 *                      sends the same frame.
 *   4003 too large     the document is at its limit, or a frame was. The same.
 *   4005 revoked       access was withdrawn. Stop.
 *   4006 role changed  reconnect, and the Worker resolves the new role.
 *
 * A handshake the Worker refuses (the session ended, the document was deleted,
 * access was removed while offline) has no close code at all: the browser
 * reports 1006 and says nothing else, indistinguishably from a dropped
 * connection. So after a few closes that never reached a sync the page asks the
 * API directly, and a 401, 403 or 404 there is the answer.
 *
 * ── Why no BroadcastChannel ─────────────────────────────────────────────────
 * The provider also syncs same-origin tabs through a BroadcastChannel by
 * default. That would carry a document between two tabs without the Worker
 * seeing either, so a tab that has lost access, or belongs to another account in
 * the same browser, would keep receiving it. It is off (`disableBc`), and every
 * tab hears every edit from the room, which is also what a test of "two tabs
 * converge" should be exercising.
 */

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import { API_BASE, LIMITS, ROOM_CLOSE } from '@shared/api';
import { publishTitle } from '../core/titles';

/** The Yjs fragment the Docs body lives in. Tiptap's own default, kept so a
 *  document made by any Tiptap client opens. Headers and footers (phase 2) get
 *  fragments of their own beside it. */
export const FIELD = 'default';

export type StopReason = 'revoked' | 'too-large' | 'protocol' | 'no-access' | 'signed-out';
export type RoomStatus = 'connecting' | 'connected' | 'offline' | 'stopped';

export type CloseAction =
  | { kind: 'retry' }
  | { kind: 'refresh-role' }
  | { kind: 'check-access' }
  | { kind: 'stop'; reason: StopReason };

/** Closes in a row that never reached a sync before the page asks the API why. */
export const ACCESS_CHECK_AFTER = 3;

/** Whether the provider should reconnect after this close. The stop codes are
 *  ours; 4001 is held while the page asks why, and resumed if the answer is fine. */
export function shouldReconnect(code: number): boolean {
  return (
    code !== ROOM_CLOSE.unauthorized &&
    code !== ROOM_CLOSE.protocol &&
    code !== ROOM_CLOSE.tooLarge &&
    code !== ROOM_CLOSE.revoked
  );
}

export function closeAction(code: number, closesSinceSync: number): CloseAction {
  switch (code) {
    case ROOM_CLOSE.revoked:
      return { kind: 'stop', reason: 'revoked' };
    case ROOM_CLOSE.tooLarge:
      return { kind: 'stop', reason: 'too-large' };
    case ROOM_CLOSE.protocol:
      return { kind: 'stop', reason: 'protocol' };
    case ROOM_CLOSE.roleChanged:
      return { kind: 'refresh-role' };
    case ROOM_CLOSE.resync:
      // A restore or a replaced sheet: nothing is wrong, the room only wants a fresh snapshot. The
      // provider reconnects on its own, and this close is not counted towards asking the API why.
      return { kind: 'retry' };
    case ROOM_CLOSE.unauthorized:
      return { kind: 'check-access' };
    default:
      return closesSinceSync >= ACCESS_CHECK_AFTER ? { kind: 'check-access' } : { kind: 'retry' };
  }
}

/** What the header says about the connection. Connected is not enough to call a
 *  page live: until the room's state has arrived the page may be missing text. */
export function liveStatus(s: { status: RoomStatus; synced: boolean }): 'live' | 'connecting' | 'offline' | 'none' {
  if (s.status === 'stopped') return 'none';
  if (s.status === 'offline') return 'offline';
  return s.status === 'connected' && s.synced ? 'live' : 'connecting';
}

/** `wss://office.example.com/api/office/documents`. The provider appends `/<id>/room`. */
export function socketBase(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${API_BASE}/documents`;
}

// ── the room's notice ───────────────────────────────────────────────────────

/** What the room says that is not Yjs: that the document is getting large, or
 *  that it has a new title. It travels as a `denied` frame with sub-type 1
 *  (worker/lib/room-protocol.ts `AUTH.notice`), which a stock provider reads as
 *  nothing at all. */
export interface RoomNotice {
  kind: 'size';
  bytes: number;
  limit: number;
}

export interface TitleNotice {
  kind: 'title';
  title: string;
}

const MSG_AUTH = 2;
const AUTH_NOTICE = 1;

/**
 * The notice in a frame, if it is one. `decoder` is where the provider's handler
 * leaves it: past the message type, at the sub-type. Reads a copy, so a frame
 * that is not a notice is still the provider's to read.
 */
export function peekNotice(decoder: decoding.Decoder): RoomNotice | TitleNotice | null {
  try {
    const copy = decoding.createDecoder(decoder.arr);
    copy.pos = decoder.pos;
    if (decoding.readVarUint(copy) !== AUTH_NOTICE) return null;
    const v: unknown = JSON.parse(decoding.readVarString(copy));
    if (typeof v === 'object' && v !== null && (v as TitleNotice).kind === 'title') {
      const { title } = v as TitleNotice;
      return typeof title === 'string' && title && title.length <= LIMITS.titleMax ? { kind: 'title', title } : null;
    }
    if (
      typeof v === 'object' &&
      v !== null &&
      (v as RoomNotice).kind === 'size' &&
      typeof (v as RoomNotice).bytes === 'number' &&
      typeof (v as RoomNotice).limit === 'number'
    ) {
      const { bytes, limit } = v as RoomNotice;
      return { kind: 'size', bytes, limit };
    }
  } catch {
    // Not ours to repair.
  }
  return null;
}

/**
 * Hand a notice to whoever it is for: a new title to every part of the page
 * showing that document (core/titles.ts), anything else to the room's own
 * handler. False when the frame is not a notice, so the provider reads it.
 */
export function takeNotice(documentId: string, decoder: decoding.Decoder, onNotice: (n: RoomNotice) => void): boolean {
  const notice = peekNotice(decoder);
  if (!notice) return false;
  if (notice.kind === 'title') publishTitle(documentId, notice.title);
  else onNotice(notice);
  return true;
}

// ── the connection ──────────────────────────────────────────────────────────

export interface RoomEvents {
  onStatus: (status: RoomStatus) => void;
  onSynced: (synced: boolean) => void;
  onStop: (reason: StopReason) => void;
  onNotice: (notice: RoomNotice) => void;
  /** The role may have changed (4006): fetch the document again. */
  onRoleChanged: () => void;
  /** Ask the API whether this person can still open the document. */
  checkAccess: () => Promise<'ok' | 'no-access' | 'signed-out'>;
}

export interface Room {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  destroy: () => void;
}

export function connectRoom(
  documentId: string,
  loc: { protocol: string; host: string },
  events: RoomEvents
): Room {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(socketBase(loc), `${encodeURIComponent(documentId)}/room`, doc, {
    disableBc: true,
    shouldReconnect: (e) => shouldReconnect(e.code)
  });

  let closesSinceSync = 0;
  let checking = false;
  let stopped = false;
  let destroyed = false;

  const stop = (reason: StopReason): void => {
    if (stopped) return;
    stopped = true;
    provider.disconnect();
    events.onStatus('stopped');
    events.onStop(reason);
  };

  // The room's notice rides on the provider's own handler for frame type 2.
  const original = provider.messageHandlers[MSG_AUTH];
  provider.messageHandlers[MSG_AUTH] = (encoder, decoder, p, emitSynced, type) => {
    if (!takeNotice(documentId, decoder, events.onNotice)) original?.(encoder, decoder, p, emitSynced, type);
  };

  const check = (resumeIfFine: boolean): void => {
    if (checking || stopped) return;
    checking = true;
    events
      .checkAccess()
      .then((answer) => {
        if (destroyed || stopped) return;
        if (answer !== 'ok') stop(answer);
        else if (resumeIfFine) provider.connect();
      })
      .catch(() => {
        // The API is not answering either: this is the network, not the account.
        if (!destroyed && !stopped && resumeIfFine) provider.connect();
      })
      .finally(() => {
        checking = false;
      });
  };

  provider.on('status', ({ status }) => {
    if (stopped) return;
    events.onStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline');
  });

  provider.on('sync', (synced: boolean) => {
    if (synced) closesSinceSync = 0;
    events.onSynced(synced);
  });

  provider.on('connection-close', (event) => {
    // `null` is a close we made ourselves (disconnect, or the provider's watchdog).
    if (!event || stopped) return;
    if (!provider.synced && event.code !== ROOM_CLOSE.resync) closesSinceSync += 1;
    const action = closeAction(event.code, closesSinceSync);
    switch (action.kind) {
      case 'stop':
        stop(action.reason);
        break;
      case 'refresh-role':
        events.onRoleChanged();
        break;
      case 'check-access':
        check(event.code === ROOM_CLOSE.unauthorized);
        break;
      case 'retry':
        break;
    }
  });

  return {
    doc,
    provider,
    awareness: provider.awareness,
    destroy: () => {
      destroyed = true;
      provider.destroy();
      doc.destroy();
    }
  };
}
