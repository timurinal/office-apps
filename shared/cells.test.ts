import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  CELL_LIMITS,
  CellListReader,
  CellListWriter,
  MSG_CELLS,
  ackFrame,
  decodeCellList,
  decodeCellsFrame,
  decodeSheetSnapshot,
  encodeCellList,
  encodeSheetSnapshot,
  opsFrame,
  remoteFrame,
  snapshotFrame,
  snapshotFrameRaw,
  type CellOp
} from './cells';

const cells: CellOp[] = [
  { sheet: 's1', row: 'r1', col: 'c1', content: { v: 42, s: 'st1' } },
  { sheet: 's1', row: 'r2', col: 'c1', content: { f: '=SUM(`r1.c1`:`r1.c2`)' } },
  { sheet: 's1', row: 'r3', col: 'c1', content: { e: '#N/A' } },
  { sheet: 's1', row: 'r4', col: 'c1', content: null }
];

describe('cell frames', () => {
  it('round-trip every sub-type', () => {
    const yjs = new Uint8Array([1, 2, 3]);
    expect(decodeCellsFrame(opsFrame(7, yjs, cells))).toEqual({ type: 'ops', clientSeq: 7, yjs, cells });
    expect(decodeCellsFrame(remoteFrame(9, new Uint8Array(), cells))).toEqual({ type: 'remote', seq: 9, yjs: new Uint8Array(), cells });
    expect(decodeCellsFrame(ackFrame(7, 9))).toEqual({ type: 'ack', clientSeq: 7, seq: 9 });
    expect(decodeCellsFrame(snapshotFrame(9, 1, 2, cells))).toEqual({ type: 'snapshot', seq: 9, part: 1, parts: 2, cells });
  });

  it('refuses another message type, trailing bytes and truncation', () => {
    const ok = ackFrame(1, 2);
    expect(decodeCellsFrame(new Uint8Array([0, ...ok.slice(1)]))).toBeNull();
    expect(decodeCellsFrame(new Uint8Array([...ok, 0]))).toBeNull();
    const ops = opsFrame(1, new Uint8Array(), cells);
    expect(decodeCellsFrame(ops.slice(0, ops.length - 3))).toBeNull();
  });

  it('refuses a bad id, an unknown field, a value of the wrong type and a part out of range', () => {
    const one = (content: unknown, row = 'r1') => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MSG_CELLS);
      encoding.writeVarUint(e, 0);
      encoding.writeVarUint(e, 1);
      encoding.writeVarUint8Array(e, new Uint8Array());
      encoding.writeVarUint(e, 1);
      for (const s of ['s1', row, 'c1', JSON.stringify(content)]) encoding.writeVarString(e, s);
      return decodeCellsFrame(encoding.toUint8Array(e));
    };
    expect(one({ v: 1 })).not.toBeNull();
    expect(one({ v: 1 }, 'r 1')).toBeNull();
    expect(one({ v: 1, x: 1 })).toBeNull();
    expect(one({ v: { a: 1 } })).toBeNull();
    expect(one({ e: 'oops' })).toBeNull();
    expect(one({ f: '' })).toBeNull();
    expect(one({ v: 'x'.repeat(CELL_LIMITS.textChars + 1) })).toBeNull();
    expect(one({ f: '=' + 'A'.repeat(CELL_LIMITS.formulaChars) })).toBeNull();
    expect(one([1])).toBeNull();
    expect(decodeCellsFrame(snapshotFrame(1, 2, 2, []))).toBeNull();
  });
});

describe('snapshotFrameRaw', () => {
  it('writes the same bytes as snapshotFrame, from the JSON the room keeps', () => {
    const present = cells.filter((c) => c.content !== null);
    const raw = present.map((c) => ({ ...c, json: new TextEncoder().encode(JSON.stringify(c.content)) }));
    expect(snapshotFrameRaw(9, 0, 1, raw)).toEqual(snapshotFrame(9, 0, 1, present));
  });
});

describe('cell list', () => {
  const sorted: CellOp[] = [
    { sheet: 's1', row: 'r1', col: 'c1', content: { v: 'Ünïcode ✓' } },
    { sheet: 's1', row: 'r1', col: 'c2', content: { v: true, s: 'st1' } },
    { sheet: 's1', row: 'r2', col: 'c1', content: { f: '=1+1', v: 2 } },
    { sheet: 's2', row: 'r1', col: 'c1', content: { e: '#DIV/0!' } }
  ];

  it('round-trips, leaving empty cells out, and writes a row once for its run', () => {
    expect(decodeCellList(encodeCellList([...sorted, { sheet: 's1', row: 'r9', col: 'c1', content: null }]))).toEqual(sorted);
    expect(decodeCellList(encodeCellList([]))).toEqual([]);
    const once = encodeCellList(sorted).length;
    const shuffled = encodeCellList([sorted[0]!, sorted[2]!, sorted[1]!, sorted[3]!]).length;
    expect(once).toBeLessThan(shuffled);
  });

  it('takes the JSON as text or as its bytes', () => {
    const a = new CellListWriter();
    const b = new CellListWriter();
    a.add('s1', 'r1', 'c1', '{"v":1}');
    b.add('s1', 'r1', 'c1', new TextEncoder().encode('{"v":1}'));
    expect(a.finish()).toEqual(b.finish());
    expect(a.count).toBe(1);
  });

  it('reads a few cells at a time, then an empty array at the end', () => {
    const r = new CellListReader(encodeCellList(sorted));
    expect(r.next(3)).toHaveLength(3);
    expect(r.next(3)).toHaveLength(1);
    expect(r.next(3)).toEqual([]);
    expect(r.count).toBe(4);
  });

  it('refuses a list past its maximum, a bad id, a bad or empty content, a wrong version and trailing bytes', () => {
    const list = encodeCellList(sorted);
    expect(decodeCellList(list, 3)).toBeNull();
    expect(decodeCellList(list, 4)).toHaveLength(4);
    const one = (row: string, json: string) => {
      const w = new CellListWriter();
      w.add('s1', row, 'c1', json);
      return decodeCellList(w.finish());
    };
    expect(one('r1', '{"v":1}')).toHaveLength(1);
    expect(one('r 1', '{"v":1}')).toBeNull();
    expect(one('r1', '{"x":1}')).toBeNull();
    expect(one('r1', '')).toBeNull();
    expect(one('r1', 'not json')).toBeNull();
    expect(decodeCellList(new Uint8Array([2, 0]))).toBeNull();
    expect(decodeCellList(new Uint8Array([...list, 0]))).toBeNull();
    expect(decodeCellList(list.subarray(0, list.length - 2))).toBeNull();
    expect(decodeCellList(new Uint8Array())).toBeNull();
  });
});

describe('sheet snapshot', () => {
  it('holds the structure and the cells, and is never read from a bare Yjs state', () => {
    const structure = new Uint8Array([1, 2, 3]);
    const list = encodeCellList(cells);
    expect(decodeSheetSnapshot(encodeSheetSnapshot(structure, list))).toEqual({ structure, cells: list });
    expect(decodeSheetSnapshot(new Uint8Array([0, 0]))).toBeNull();
    const whole = encodeSheetSnapshot(structure, list);
    expect(decodeSheetSnapshot(whole.subarray(0, whole.length - 1))).toBeNull();
    expect(decodeSheetSnapshot(new Uint8Array([...whole, 0]))).toBeNull();
  });
});
