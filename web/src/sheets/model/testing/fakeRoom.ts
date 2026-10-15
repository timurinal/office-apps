/**
 * The room, in memory, for the model's tests: the same frames (shared/cells.ts, encoded and
 * decoded on the way), the same sequencing and last-write-wins, and the same join (the
 * structure first, then the snapshot in parts), with the network under the test's control.
 *
 * Nothing moves until the test says so. A model's `send` queues its frame at the room;
 * `process()` applies what has arrived, in arrival order, and queues each client's acks and
 * remotes in its inbox; `deliver()` hands a client's inbox to its model. `flush()` does both
 * until nothing is left. A test that needs an ordering the network could produce edits an
 * inbox directly before delivering it.
 *
 * Like the cloud source, a client here never sends the room its Yjs outside a frame: the room
 * learns structure only from steps.
 */

import * as Y from 'yjs';
import {
  type CellOp,
  type CellsFrame,
  type StoredCell,
  ackFrame,
  decodeCellsFrame,
  remoteFrame,
  snapshotFrame
} from '@shared/cells';
import type { RoomStatus } from '../../../docs/room';
import { CLOUD_FEATURES } from '../../../docs/source';
import { REMOTE, type SheetEvents, type SheetSource } from '../source';

export type Delivery =
  | { kind: 'status'; status: RoomStatus }
  | { kind: 'synced' }
  /** The provider's sync: step 2 or an update. */
  | { kind: 'yjs'; update: Uint8Array }
  | { kind: 'frame'; frame: CellsFrame };

const key = (op: { sheet: string; row: string; col: string }) => `${op.sheet}\u0000${op.row}\u0000${op.col}`;

function decode(bytes: Uint8Array): CellsFrame {
  const f = decodeCellsFrame(bytes);
  if (!f) throw new Error('A frame that does not decode');
  return f;
}

export class FakeClient {
  online = false;
  /** What the room has sent this client and it has not yet read. */
  readonly inbox: Delivery[] = [];
  readonly source: SheetSource;
  doc: Y.Doc | null = null;
  private events: SheetEvents | null = null;

  constructor(
    private readonly room: FakeRoom,
    readonly name: string,
    /** How many parts the snapshot comes in on joining. */
    public parts = 1
  ) {
    this.source = {
      kind: 'cloud',
      id: room.id,
      features: CLOUD_FEATURES,
      connect: (events) => {
        this.events = events;
        const doc = (this.doc = new Y.Doc());
        this.open();
        return {
          doc,
          awareness: null,
          send: (bytes) => {
            if (!this.online) return false;
            this.room.arrive(this, bytes);
            return true;
          },
          destroy: () => {
            this.online = false;
            this.events = null;
            this.inbox.length = 0;
            this.room.drop(this);
          }
        };
      }
    };
  }

  /** The socket opens: the structure the client lacks, then every cell as of now. */
  private open(): void {
    this.online = true;
    this.inbox.push({ kind: 'status', status: 'connected' });
    this.inbox.push({ kind: 'yjs', update: Y.encodeStateAsUpdate(this.room.doc, Y.encodeStateVector(this.doc!)) });
    this.inbox.push({ kind: 'synced' });
    const cells = [...this.room.cells.values()];
    const parts = Math.max(1, this.parts);
    const size = Math.ceil(cells.length / parts);
    for (let p = 0; p < parts; p++) {
      this.inbox.push({ kind: 'frame', frame: decode(snapshotFrame(this.room.seq, p, parts, cells.slice(p * size, (p + 1) * size))) });
    }
  }

  /** The socket drops: what was in flight either way is lost. */
  disconnect(): void {
    this.online = false;
    this.inbox.length = 0;
    this.room.drop(this);
    this.events?.onStatus('offline');
  }

  reconnect(): void {
    if (!this.online) this.open();
  }

  /** Hands the model up to `max` of what is waiting; answers how many. */
  deliver(max = Infinity): number {
    let n = 0;
    while (n < max && this.inbox.length && this.events) {
      const d = this.inbox.shift()!;
      n++;
      if (d.kind === 'status') this.events.onStatus(d.status);
      else if (d.kind === 'synced') this.events.onSynced(true);
      else if (d.kind === 'yjs') Y.applyUpdate(this.doc!, d.update, REMOTE);
      else this.events.onFrame(d.frame);
    }
    return n;
  }
}

export class FakeRoom {
  readonly doc = new Y.Doc();
  readonly cells = new Map<string, CellOp>();
  seq = 0;
  /** Each step the room applied, in seq order. */
  readonly log: { client: string; clientSeq: number; seq: number; cells: CellOp[] }[] = [];
  private readonly clients: FakeClient[] = [];
  private arrivals: { client: FakeClient; bytes: Uint8Array }[] = [];

  constructor(
    seed: { state?: Uint8Array; cells?: readonly CellOp[] } = {},
    /** The document's id: our own copy pastes as formulas only within one. */
    readonly id = 'fakeroom'
  ) {
    if (seed.state) Y.applyUpdate(this.doc, seed.state);
    for (const op of seed.cells ?? []) if (op.content) this.cells.set(key(op), op);
  }

  client(name = `c${this.clients.length + 1}`, parts = 1): FakeClient {
    const c = new FakeClient(this, name, parts);
    this.clients.push(c);
    return c;
  }

  cell(sheet: string, row: string, col: string): StoredCell | null {
    return this.cells.get(key({ sheet, row, col }))?.content ?? null;
  }

  /** Frames that have reached the room and not been applied. */
  get waiting(): number {
    return this.arrivals.length;
  }

  arrive(client: FakeClient, bytes: Uint8Array): void {
    this.arrivals.push({ client, bytes });
  }

  /** A closed socket's frames never reach the room. */
  drop(client: FakeClient): void {
    this.arrivals = this.arrivals.filter((a) => a.client !== client);
  }

  /** Applies up to `max` frames that have arrived, as the room does: one seq each, ack to the sender, remote to the rest. */
  process(max = Infinity): number {
    let n = 0;
    while (n < max && this.arrivals.length) {
      const { client, bytes } = this.arrivals.shift()!;
      n++;
      const f = decode(bytes);
      if (f.type !== 'ops') throw new Error(`A client sent a ${f.type} frame`);
      const seq = ++this.seq;
      if (f.yjs.length) Y.applyUpdate(this.doc, f.yjs);
      for (const op of f.cells) {
        if (!op.content || Object.keys(op.content).length === 0) this.cells.delete(key(op));
        else this.cells.set(key(op), op);
      }
      this.log.push({ client: client.name, clientSeq: f.clientSeq, seq, cells: f.cells });
      client.inbox.push({ kind: 'frame', frame: decode(ackFrame(f.clientSeq, seq)) });
      const remote = decode(remoteFrame(seq, f.yjs, f.cells));
      for (const other of this.clients) if (other !== client && other.online) other.inbox.push({ kind: 'frame', frame: remote });
    }
    return n;
  }

  /** Processes and delivers until nothing moves. */
  flush(): void {
    for (let i = 0; i < 1000; i++) {
      let moved = this.process();
      for (const c of this.clients) moved += c.deliver();
      if (moved === 0) return;
    }
    throw new Error('The room never went quiet');
  }
}
