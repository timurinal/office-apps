/**
 * Sheets' cell frames: the wire between a Sheets client and its room (the
 * Sheets model). Written before either side, so both could be built at once; change a shape only
 * with both sides in the same commit.
 *
 * A sheet's structure (sheets, row and column order, sizes, formats, merges) is Yjs and
 * travels as Yjs. Its cells do not: a `Y.Map` of cells tops out near 85k cells (spike S3),
 * so they are sequenced ops in the room's SQLite, one row per cell, last write wins (S1's
 * option (b)). They ride a message type of their own, `4`, beside y-websocket's
 * `0 sync`, `1 awareness` and `2 auth`; y-websocket's own `3` (queryAwareness) is left alone.
 * A stock `WebsocketProvider` still connects to any room. A Sheets client adds a handler for
 * `4` and sends its ops itself.
 *
 * Every frame starts `[MSG_CELLS, sub-type]`:
 *
 *   0 ops       client -> room   clientSeq, yjs, cells   one undoable step, applied whole
 *   1 remote    room -> client   seq, yjs, cells         someone else's step, as applied
 *   2 ack       room -> client   clientSeq, seq          your step was applied as `seq`
 *   3 snapshot  room -> client   seq, part, parts, cells the whole cell set as of `seq`
 *
 * `yjs` is one Yjs update, empty for none. It travels **inside** the step, never as a
 * separate sync message, so a row delete and the range rewrites it needs land in one step
 * for everyone. A client therefore applies its own structure changes under an origin its
 * provider does not broadcast, and sends them here.
 *
 * Two rules from S1 make last-write-wins safe (`spikes/s1-sheets-engine/src/split-room.ts`):
 * deleting a row deletes no cells (they are orphans an undo brings back), and a client
 * ignores a remote write to a cell it has an unacknowledged write to.
 *
 * A step the room refuses (a viewer's, one over a cap, one that does not decode) closes the
 * socket, as a refused Yjs update does (`worker/lib/room-protocol.ts`): the client has
 * already applied it and believes it shared.
 *
 * ── Joining: the snapshot and the steps around it ───────────────────────────
 * After the room answers a client's sync step 1 (step 2, and its own step 1 to an editor),
 * it sends the whole cell set as `parts` snapshot frames, every one stamped with the same
 * `seq`: the last step the room had stored when it answered. Steps keep being applied
 * while the parts go out, so the rule on the client is:
 *
 *   1. From connecting until the last part (`part === parts - 1`) has arrived, hold every
 *      `remote` frame instead of applying it, and keep every step you send, with the `seq`
 *      its `ack` gives it.
 *   2. Then replace every cell held with the snapshot's (a cell not in it is empty), and
 *      apply over it, in `seq` order, the held remotes and your acknowledged steps whose
 *      `seq` is greater than the snapshot's. Drop the rest: their cells are in the
 *      snapshot and their `yjs` was in step 2.
 *   3. Apply your unacknowledged steps over that, as for a remote.
 *
 * A cell a later step rewrote or emptied is left out of the snapshot rather than sent at
 * its old value: the step's `remote` carries it, or, for your own step, nothing does, which
 * is why 1 keeps them. Steps resent after a reconnect are such steps. Parts can be empty, the last ones in
 * particular. A step 1 sent while a snapshot is still going out gets no second snapshot.
 * `yjs` in a step never also arrives as a sync update, so a stock `WebsocketProvider` in a
 * sheet's room sees structure only on its next handshake: a Sheets client must speak `4`.
 *
 * ── Restore ─────────────────────────────────────────────────────────────────
 * A restore replaces structure and cells at once and then closes every socket with
 * `ROOM_CLOSE.resync` (shared/api.ts). Every step acknowledged before the close is in
 * the restored document's history; none sent after it was applied. Reconnect, take the
 * new snapshot, and send the unacknowledged steps again.
 */

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/** The message type. y-websocket uses 0 to 3. */
export const MSG_CELLS = 4;

export const CELLS = { ops: 0, remote: 1, ack: 2, snapshot: 3 } as const;

/**
 * A cell as stored and sent: the engine's `CellContent` plus `s`, a style id from the
 * structure document's style table. A cell with only `s` is a formatted empty cell.
 */
export interface StoredCell {
  v?: number | string | boolean;
  /** An error literal, such as `#N/A`. */
  e?: string;
  /** A formula in the engine's stored form, references as ids. */
  f?: string;
  s?: string;
}

/** One write. `content: null` empties the cell. */
export interface CellOp {
  sheet: string;
  row: string;
  col: string;
  content: StoredCell | null;
}

export type CellsFrame =
  | { type: 'ops'; clientSeq: number; yjs: Uint8Array; cells: CellOp[] }
  | { type: 'remote'; seq: number; yjs: Uint8Array; cells: CellOp[] }
  | { type: 'ack'; clientSeq: number; seq: number }
  | { type: 'snapshot'; seq: number; part: number; parts: number; cells: CellOp[] };

/**
 * Caps, checked by the client before it sends and by the room when it receives.
 *
 * Measured on 2026-10-15 in local workerd (vitest-pool-workers, a Ryzen 9 5950X), on a
 * sheet of 20 columns, one cell in four a short string and the rest numbers:
 *
 *                                  400k cells          500k cells
 *   seed (`replace-sheet` import)  4.0 s               4.9 s
 *   join: step 1 to the last part  3.3 s, 26 parts,    4.0 s, 32 parts,
 *                                  11.3 MB on the wire 14.3 MB
 *   the same after an eviction     3.3 s               4.0 s
 *   compaction (container to R2)   2.5 s, 7.8 MB       3.1 s, 9.7 MB
 *   `readDocument`                 2.4 s, list 7.6 MB  list 9.6 MB
 *
 * An eviction costs nothing extra: the room never loads its cells, it streams them a
 * page at a time, so a join is the same work warm or cold, and it is opening 400k sealed
 * cells that takes most of it. A step of 100k writes took 1.6 s to its ack, in a 2.7 MB
 * frame. workerd does not report an isolate's heap (`process.memoryUsage()` answers
 * zeros), so memory is bounded by construction instead: a join holds one page of rows
 * and one part; a copy, a template, an export and a compaction hold one whole cell list,
 * at most `listBytes`, about three times over at the peak. Hence the caps: 500k cells is
 * about 4 s of a room's time per person opening the sheet, and a 100k-write step stays
 * well inside the 4 MiB frame cap.
 */
export const CELL_LIMITS = {
  /** Excel's own limit on a cell's text. */
  textChars: 32_767,
  /** Excel's own limit on a formula's length. */
  formulaChars: 8_192,
  /** Ids are the model's, short and URL-safe. */
  idChars: 64,
  /** Writes in one step. A paste or fill larger than this is refused before it is sent. */
  opsPerFrame: 100_000,
  /** Non-empty cells in one document, orphans included. */
  cellsPerDocument: 500_000,
  /**
   * A document's cells in bytes, orphans included: each cell's three ids and its content's
   * JSON (`cellWeight`). Set so that every sheet the room can hold fits one cell list
   * (`listBytes`, with 7 bytes of framing a cell), which is what a copy, a template, an
   * export and the room's own snapshot read whole.
   */
  bytesPerDocument: 12 * 1024 * 1024,
  /** The page warns past this. */
  cellsWarn: 400_000,
  /** A snapshot part's cells, so no frame nears the room's frame cap. */
  snapshotPartCells: 20_000,
  /** A snapshot part's content, in bytes of JSON: a part closes at this or at its cells. */
  snapshotPartBytes: 1024 * 1024,
  /** A cell list (below), in bytes: `POST /documents`' `cells`, decoded. */
  listBytes: 16 * 1024 * 1024
} as const;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What one cell counts against `bytesPerDocument`. Ids are ASCII, so their length is their bytes. */
export const cellWeight = (sheet: string, row: string, col: string, jsonBytes: number): number =>
  sheet.length + row.length + col.length + jsonBytes;

/** The UTF-8 length of `s`, without encoding it. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function writeCells(e: encoding.Encoder, cells: readonly CellOp[]): void {
  encoding.writeVarUint(e, cells.length);
  for (const c of cells) {
    encoding.writeVarString(e, c.sheet);
    encoding.writeVarString(e, c.row);
    encoding.writeVarString(e, c.col);
    encoding.writeVarString(e, c.content === null ? '' : JSON.stringify(c.content));
  }
}

function frame(sub: number, body: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_CELLS);
  encoding.writeVarUint(e, sub);
  body(e);
  return encoding.toUint8Array(e);
}

export const opsFrame = (clientSeq: number, yjs: Uint8Array, cells: readonly CellOp[]): Uint8Array =>
  frame(CELLS.ops, (e) => {
    encoding.writeVarUint(e, clientSeq);
    encoding.writeVarUint8Array(e, yjs);
    writeCells(e, cells);
  });

export const remoteFrame = (seq: number, yjs: Uint8Array, cells: readonly CellOp[]): Uint8Array =>
  frame(CELLS.remote, (e) => {
    encoding.writeVarUint(e, seq);
    encoding.writeVarUint8Array(e, yjs);
    writeCells(e, cells);
  });

export const ackFrame = (clientSeq: number, seq: number): Uint8Array =>
  frame(CELLS.ack, (e) => {
    encoding.writeVarUint(e, clientSeq);
    encoding.writeVarUint(e, seq);
  });

export const snapshotFrame = (seq: number, part: number, parts: number, cells: readonly CellOp[]): Uint8Array =>
  frame(CELLS.snapshot, (e) => {
    encoding.writeVarUint(e, seq);
    encoding.writeVarUint(e, part);
    encoding.writeVarUint(e, parts);
    writeCells(e, cells);
  });

/** A stored cell, checked: only the four known fields, each of its type and within its cap. */
export function parseStoredCell(text: string): StoredCell | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: StoredCell = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (k === 'v') {
      if (typeof val === 'number') {
        if (!Number.isFinite(val)) return null;
      } else if (typeof val === 'string') {
        if (val.length > CELL_LIMITS.textChars) return null;
      } else if (typeof val !== 'boolean') return null;
      out.v = val;
    } else if (k === 'e') {
      if (typeof val !== 'string' || !/^#[A-Z0-9_/!?]{2,13}$/.test(val)) return null;
      out.e = val;
    } else if (k === 'f') {
      if (typeof val !== 'string' || val.length === 0 || val.length > CELL_LIMITS.formulaChars) return null;
      out.f = val;
    } else if (k === 's') {
      if (typeof val !== 'string' || !ID.test(val)) return null;
      out.s = val;
    } else return null;
  }
  return out;
}

function readCells(d: decoding.Decoder): CellOp[] | null {
  const n = decoding.readVarUint(d);
  if (n > CELL_LIMITS.opsPerFrame) return null;
  const cells: CellOp[] = [];
  for (let i = 0; i < n; i++) {
    const sheet = decoding.readVarString(d);
    const row = decoding.readVarString(d);
    const col = decoding.readVarString(d);
    const text = decoding.readVarString(d);
    if (!ID.test(sheet) || !ID.test(row) || !ID.test(col)) return null;
    let content: StoredCell | null = null;
    if (text !== '') {
      content = parseStoredCell(text);
      if (!content) return null;
    }
    cells.push({ sheet, row, col, content });
  }
  return cells;
}

/**
 * A cell whose content is already the UTF-8 of its JSON, as the room keeps it, so it is
 * written into a frame or a list without being parsed or decoded again. Byte for byte the
 * same as writing the string: lib0's varString is a varUint length and the UTF-8.
 */
export interface RawCell {
  sheet: string;
  row: string;
  col: string;
  json: Uint8Array;
}

/** `snapshotFrame` from cells the room has not parsed. */
export const snapshotFrameRaw = (seq: number, part: number, parts: number, cells: readonly RawCell[]): Uint8Array =>
  frame(CELLS.snapshot, (e) => {
    encoding.writeVarUint(e, seq);
    encoding.writeVarUint(e, part);
    encoding.writeVarUint(e, parts);
    encoding.writeVarUint(e, cells.length);
    for (const c of cells) {
      encoding.writeVarString(e, c.sheet);
      encoding.writeVarString(e, c.row);
      encoding.writeVarString(e, c.col);
      encoding.writeVarUint8Array(e, c.json);
    }
  });

/**
 * Decodes one frame of type `MSG_CELLS`. null for anything malformed, truncated, carrying
 * trailing bytes, or over a cap, which the room answers by closing the socket.
 */
export function decodeCellsFrame(bytes: Uint8Array): CellsFrame | null {
  try {
    const d = decoding.createDecoder(bytes);
    if (decoding.readVarUint(d) !== MSG_CELLS) return null;
    const sub = decoding.readVarUint(d);
    let out: CellsFrame | null = null;
    if (sub === CELLS.ops || sub === CELLS.remote) {
      const n = decoding.readVarUint(d);
      const yjs = decoding.readVarUint8Array(d);
      const cells = readCells(d);
      if (!cells) return null;
      out = sub === CELLS.ops ? { type: 'ops', clientSeq: n, yjs, cells } : { type: 'remote', seq: n, yjs, cells };
    } else if (sub === CELLS.ack) {
      out = { type: 'ack', clientSeq: decoding.readVarUint(d), seq: decoding.readVarUint(d) };
    } else if (sub === CELLS.snapshot) {
      const seq = decoding.readVarUint(d);
      const part = decoding.readVarUint(d);
      const parts = decoding.readVarUint(d);
      if (parts < 1 || part >= parts) return null;
      const cells = readCells(d);
      if (!cells) return null;
      out = { type: 'snapshot', seq, part, parts, cells };
    }
    if (!out || decoding.hasContent(d)) return null;
    return out;
  } catch {
    return null;
  }
}

// ── a cell list: the seed's `cells`, and the cell half of a sheet's snapshot ──

/**
 * A whole cell set as bytes, for what is not a frame: `POST /documents`' `cells`
 * (shared/api.ts), the cell half of a sheet's snapshot in R2, and an export. Every cell in
 * it is non-empty; a cell that is not in it is empty. A later duplicate wins.
 *
 *   varUint 1                                           the version
 *   then runs of one row:  varUint n (n >= 1), varString sheet, varString row,
 *                          n x (varString col, varString content JSON)
 *   varUint 0                                           the end
 *
 * Cells of one row are written as a run, so a row's two ids are written once rather than
 * once per cell; sorted input makes the fewest runs, and unsorted input is still valid.
 */
export const CELL_LIST_VERSION = 1;

const utf8 = new TextEncoder();

export class CellListWriter {
  private readonly e = encoding.createEncoder();
  private runSheet = '';
  private runRow = '';
  private run: Array<[string, Uint8Array | string]> = [];
  /** Cells written so far. */
  count = 0;

  constructor() {
    encoding.writeVarUint(this.e, CELL_LIST_VERSION);
  }

  /** `json` is the content's JSON, as text or as its UTF-8. */
  add(sheet: string, row: string, col: string, json: Uint8Array | string): void {
    if (this.run.length > 0 && (sheet !== this.runSheet || row !== this.runRow)) this.flush();
    this.runSheet = sheet;
    this.runRow = row;
    this.run.push([col, json]);
    this.count++;
  }

  finish(): Uint8Array {
    this.flush();
    encoding.writeVarUint(this.e, 0);
    return encoding.toUint8Array(this.e);
  }

  private flush(): void {
    if (this.run.length === 0) return;
    encoding.writeVarUint(this.e, this.run.length);
    encoding.writeVarString(this.e, this.runSheet);
    encoding.writeVarString(this.e, this.runRow);
    for (const [col, json] of this.run) {
      encoding.writeVarString(this.e, col);
      if (typeof json === 'string') encoding.writeVarString(this.e, json);
      else encoding.writeVarUint8Array(this.e, json);
    }
    this.run = [];
  }
}

/** A cell list from cells; an empty one (`content: null`) is left out. */
export function encodeCellList(cells: Iterable<CellOp>): Uint8Array {
  const w = new CellListWriter();
  for (const c of cells) if (c.content !== null) w.add(c.sheet, c.row, c.col, JSON.stringify(c.content));
  return w.finish();
}

/**
 * Reads a cell list a few cells at a time, checking each as `decodeCellsFrame` does, so a
 * room can seal and store a large one without holding all of it parsed. `next` answers
 * null for anything malformed, past `max` cells, or with bytes after the end.
 */
export class CellListReader {
  private readonly d: decoding.Decoder;
  private sheet = '';
  private row = '';
  private left = 0;
  private ended = false;
  private failed = false;
  /** Cells read so far. */
  count = 0;
  /** Their `cellWeight`, with the content as `JSON.stringify` writes it, which is how a room stores it. */
  bytes = 0;

  constructor(bytes: Uint8Array, private readonly max: number = CELL_LIMITS.cellsPerDocument) {
    this.d = decoding.createDecoder(bytes);
    try {
      if (decoding.readVarUint(this.d) !== CELL_LIST_VERSION) this.failed = true;
    } catch {
      this.failed = true;
    }
  }

  /** Up to `n` more cells; an empty array once the list has ended. */
  next(n: number): Array<CellOp & { content: StoredCell }> | null {
    if (this.failed) return null;
    const out: Array<CellOp & { content: StoredCell }> = [];
    try {
      while (out.length < n && !this.ended) {
        if (this.left === 0) {
          const run = decoding.readVarUint(this.d);
          if (run === 0) {
            this.ended = true;
            if (decoding.hasContent(this.d)) return this.fail();
            break;
          }
          this.sheet = decoding.readVarString(this.d);
          this.row = decoding.readVarString(this.d);
          if (!ID.test(this.sheet) || !ID.test(this.row)) return this.fail();
          this.left = run;
        }
        const col = decoding.readVarString(this.d);
        const content = parseStoredCell(decoding.readVarString(this.d));
        if (!ID.test(col) || !content) return this.fail();
        this.left--;
        if (++this.count > this.max) return this.fail();
        this.bytes += cellWeight(this.sheet, this.row, col, utf8Length(JSON.stringify(content)));
        out.push({ sheet: this.sheet, row: this.row, col, content });
      }
    } catch {
      return this.fail();
    }
    return out;
  }

  private fail(): null {
    this.failed = true;
    return null;
  }
}

/** The whole list, checked, or null. Holds every cell at once: a room uses the reader. */
export function decodeCellList(
  bytes: Uint8Array,
  max: number = CELL_LIMITS.cellsPerDocument
): Array<CellOp & { content: StoredCell }> | null {
  const r = new CellListReader(bytes, max);
  const out: Array<CellOp & { content: StoredCell }> = [];
  for (;;) {
    const got = r.next(4096);
    if (!got) return null;
    if (got.length === 0) return out;
    for (const c of got) out.push(c);
  }
}

// ── a sheet's snapshot: structure and cells in one object ────────────────────

/**
 * What a sheet's R2 snapshot and every one of its versions hold, sealed as one object,
 * and what `GET /documents/:id/versions/:versionId/snapshot` answers for a sheet:
 *
 *   "MVS1"                      four bytes, so it is never mistaken for a Yjs update
 *   varUint 1                   the version
 *   varUint8Array structure     the structure document's Yjs state
 *   varUint8Array cells         a cell list (above)
 *
 * Docs and Slides keep a bare Yjs state. A sheet's snapshot from before phase 4 is a bare
 * Yjs state too, with no cells; `decodeSheetSnapshot` answers null for one.
 */
const SHEET_MAGIC = utf8.encode('MVS1');

export function encodeSheetSnapshot(structure: Uint8Array, cells: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeUint8Array(e, SHEET_MAGIC);
  encoding.writeVarUint(e, 1);
  encoding.writeVarUint8Array(e, structure);
  encoding.writeVarUint(e, cells.length);
  // The cells copied once, straight into place: the list can be most of a room's memory.
  const head = encoding.toUint8Array(e);
  const out = new Uint8Array(head.length + cells.length);
  out.set(head);
  out.set(cells, head.length);
  return out;
}

/** The two halves, not checked: the cells go through `CellListReader`. null for anything else. */
export function decodeSheetSnapshot(bytes: Uint8Array): { structure: Uint8Array; cells: Uint8Array } | null {
  if (bytes.length < SHEET_MAGIC.length || SHEET_MAGIC.some((b, i) => bytes[i] !== b)) return null;
  try {
    const d = decoding.createDecoder(bytes.subarray(SHEET_MAGIC.length));
    if (decoding.readVarUint(d) !== 1) return null;
    const structure = decoding.readVarUint8Array(d);
    const cells = decoding.readVarUint8Array(d);
    if (decoding.hasContent(d)) return null;
    return { structure, cells };
  } catch {
    return null;
  }
}
