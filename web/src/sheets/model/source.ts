/**
 * Where a workbook comes from: the room, or a file in this process. The same seam as Docs'
 * (docs/source.ts), with one more thing to carry: the cell frames of shared/cells.ts.
 *
 *     new SheetModel(cloudSheetSource(id), …)                   the web
 *     new SheetModel(localSheetSource({ state, cells }), …)     the desktop, a file on disk
 *
 * The model asks a source for a connection: a `Y.Doc` for the structure, the awareness that
 * carries other people's selections (null for a file), and `send` for its steps. Everything
 * after that is frames, in and out, and both sources speak them the same way, so the model
 * has no branch for either. `features` says which server features exist, as in Docs.
 *
 * ── The cloud ───────────────────────────────────────────────────────────────
 * Docs' room connection (docs/room.ts) with three changes to its provider, all made before
 * the socket can open:
 *
 *   · The provider broadcasts nothing the page changes. Its update handler sends every
 *     local Yjs update as a sync message, and a Sheets step's structure must travel inside
 *     the step's own frame, with its cells, under one seq (shared/cells.ts). Telling the
 *     handler apart by origin is not enough: the UndoManager's transactions carry the
 *     UndoManager as their origin, so it is detached outright.
 *   · The room's sync step 1 is answered with an empty step 2. The default answer is every
 *     local change the room lacks, which is exactly the queued steps, and they go again as
 *     frames when the connection opens. Remote sync updates are applied under the model's
 *     own remote origin, so the model can tell them from its own.
 *   · Message type 4 goes to the model, decoded. A frame that does not decode is dropped; the
 *     room never sends one, and closing would only reconnect into it.
 */

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type { Awareness } from 'y-protocols/awareness';
import { CELLS, type CellOp, type CellsFrame, MSG_CELLS, decodeCellsFrame } from '@shared/cells';
import { connectRoom, type RoomEvents } from '../../docs/room';
import { CLOUD_FEATURES, NO_FEATURES, type SourceFeatures } from '../../docs/source';

export type { SourceFeatures };

/** The origin of every Yjs change that came from elsewhere: the room's sync, a remote step, a file. */
export const REMOTE = Symbol('sheets-remote');

export interface SheetEvents extends RoomEvents {
  /** A cells frame from the room, or the file's snapshot and acknowledgements. */
  onFrame: (frame: CellsFrame) => void;
}

export interface SheetConnection {
  doc: Y.Doc;
  /** Null when nobody else can be here: a local file. */
  awareness: Awareness | null;
  /** Sends one frame. False when there is no open socket; the model sends it again on reconnecting. */
  send: (frame: Uint8Array) => boolean;
  destroy: () => void;
}

export interface SheetSource {
  readonly kind: 'cloud' | 'local';
  readonly id: string;
  readonly features: SourceFeatures;
  /** Open it. Events arrive after this returns, never during. */
  connect(events: SheetEvents): SheetConnection;
}

// ── cloud ───────────────────────────────────────────────────────────────────

const MSG_SYNC = 0;

type Connect = typeof connectRoom;

/** The room and the API. `connect` is injectable, as Docs' is, so a test needs no socket. */
export function cloudSheetSource(id: string, connect: Connect = connectRoom): SheetSource {
  return {
    kind: 'cloud',
    id,
    features: CLOUD_FEATURES,
    connect(events) {
      const room = connect(id, window.location, events);
      const { provider, doc } = room;
      doc.off('update', provider._updateHandler);
      provider.messageHandlers[MSG_SYNC] = (encoder, decoder, p, emitSynced) => {
        encoding.writeVarUint(encoder, MSG_SYNC);
        const type = decoding.readVarUint(decoder);
        if (type === syncProtocol.messageYjsSyncStep1) {
          decoding.readVarUint8Array(decoder);
          syncProtocol.writeSyncStep2(encoder, new Y.Doc());
          return;
        }
        // Step 2 and updates: applied as the stock handler would, under the model's origin.
        Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), REMOTE);
        if (emitSynced && type === syncProtocol.messageYjsSyncStep2 && !p.synced) p.synced = true;
      };
      provider.messageHandlers[MSG_CELLS] = (_encoder, decoder) => {
        const frame = decodeCellsFrame(decoder.arr);
        if (frame) events.onFrame(frame);
      };
      return {
        doc,
        awareness: room.awareness,
        send: (frame) => {
          const ws = provider.ws;
          if (!ws || !provider.wsconnected || ws.readyState !== 1) return false;
          ws.send(frame);
          return true;
        },
        destroy: room.destroy
      };
    }
  };
}

// ── local ───────────────────────────────────────────────────────────────────

/** A workbook as a file holds it: the structure as one Yjs update, and the cells beside it. */
export interface SheetFile {
  state: Uint8Array;
  cells: CellOp[];
}

export interface LocalSheetSource extends SheetSource {
  readonly kind: 'local';
}

/**
 * A workbook that lives in this process, with the network off. It plays the room's part for
 * the model: the cells arrive as one snapshot, and each step is acknowledged as soon as it is
 * sent, so the model's save state reads saved. The host saves with `model.export()`.
 *
 * `doc` is the host's when given and is not destroyed; otherwise one is made from `state`.
 */
export function localSheetSource(opts: { doc?: Y.Doc; state?: Uint8Array; cells?: readonly CellOp[]; id?: string } = {}): LocalSheetSource {
  return {
    kind: 'local',
    id: opts.id ?? 'local',
    features: { ...NO_FEATURES, rename: true },
    connect(events) {
      const own = !opts.doc;
      const doc = opts.doc ?? new Y.Doc();
      if (opts.state && opts.state.length) Y.applyUpdate(doc, opts.state, REMOTE);
      let seq = 0;
      let open = true;
      // After the caller has stored the connection, as Docs' local source does.
      queueMicrotask(() => {
        if (!open) return;
        events.onStatus('connected');
        events.onSynced(true);
        events.onFrame({ type: 'snapshot', seq: 0, part: 0, parts: 1, cells: [...(opts.cells ?? [])] });
      });
      return {
        doc,
        awareness: null,
        send: (bytes) => {
          // Only the header: there is nobody to check the cells for.
          const d = decoding.createDecoder(bytes);
          if (decoding.readVarUint(d) !== MSG_CELLS || decoding.readVarUint(d) !== CELLS.ops) return false;
          const clientSeq = decoding.readVarUint(d);
          queueMicrotask(() => {
            if (open) events.onFrame({ type: 'ack', clientSeq, seq: ++seq });
          });
          return true;
        },
        destroy: () => {
          open = false;
          if (own) doc.destroy();
        }
      };
    }
  };
}
