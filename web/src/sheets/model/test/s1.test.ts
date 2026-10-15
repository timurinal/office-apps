/**
 * The rules that make last-write-wins cells safe beside a Yjs structure (spike S1,
 * option b), each with the test that fails when the rule is taken out:
 *
 *   orphans            deleting a row deletes none of its cells     'a delete races an edit…'
 *   unacknowledged     a remote write to a cell this client wrote   'the later seq wins…'
 *                      and the room has not acknowledged is ignored,
 *                      and so is a snapshot's word on it            'a local edit made before…'
 *   the cut-off        a snapshot at seq N drops remotes ≤ N, and   'a snapshot drops…'
 *                      every frame waits for its last part
 *   the outbox         offline steps go, in order, after the join   'offline steps replay…'
 *   repeats            two moves of one line leave one copy         'two people move…'
 */

import { describe, expect, it } from 'vitest';
import { type CellsFrame, decodeCellsFrame, remoteFrame } from '@shared/cells';
import { SheetModel } from '../model';
import { sheetIdsInOrder, sheetOrderOf, sheetsOf } from '../structure';
import { at, edit, grid, room, text, type } from './helpers';

const rowOrder = (m: SheetModel, sheet: string) => [...m.engine.sheet(sheet)!.rowOrder];

describe('rows inserted at once', () => {
  it('keeps every formula on its cells, the same for both people', () => {
    const { room: r, people, sheet } = room((b) => {
      const s = b.addSheet('Sheet1');
      s.cell(0, 0, { value: 1 }).cell(1, 0, { value: 2 }).cell(2, 0, { value: 3 });
      s.cell(0, 1, { formula: 'SUM(A1:A3)' });
    });
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    a.insertRows(sheet, 1, 1);
    type(a, sheet, 'A2', '10');
    b.insertRows(sheet, 0, 2);
    type(b, sheet, 'A1', '100');
    r.flush();

    expect(rowOrder(a, sheet)).toEqual(rowOrder(b, sheet));
    expect(rowOrder(a, sheet)).toHaveLength(1003);
    // The formula is two rows down, its range grown by the row inserted inside it.
    expect(edit(a, sheet, 'B3')).toBe('=SUM(A3:A6)');
    expect(edit(b, sheet, 'B3')).toBe('=SUM(A3:A6)');
    expect(text(a, sheet, 'B3')).toBe('16');
    expect(text(b, sheet, 'A1')).toBe('100');
    expect(grid(a, sheet, 7, 2)).toEqual(grid(b, sheet, 7, 2));
  });
});

describe('one cell written at once', () => {
  it('the later seq wins, for the person whose write came first too', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people as [(typeof people)[0], (typeof people)[0]];
    type(a.model, sheet, 'C3', 'first');
    type(b.model, sheet, 'C3', 'second');
    r.process();
    // b now holds, in order: a's write (seq 1), then the ack of its own (seq 2).
    expect(b.client.inbox.map((d) => (d.kind === 'frame' ? d.frame.type : d.kind))).toEqual(['remote', 'ack']);
    a.client.deliver();
    b.client.deliver();
    expect(text(a.model, sheet, 'C3')).toBe('second');
    expect(text(b.model, sheet, 'C3')).toBe('second');
  });

  it('the other way round', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    type(b, sheet, 'C3', 'second');
    type(a, sheet, 'C3', 'first');
    r.flush();
    expect(text(a, sheet, 'C3')).toBe('first');
    expect(text(b, sheet, 'C3')).toBe('first');
  });

  it('a remote write after the ack is applied', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    type(a, sheet, 'C3', 'mine');
    r.flush();
    type(b, sheet, 'C3', 'theirs');
    r.flush();
    expect(text(a, sheet, 'C3')).toBe('theirs');
  });
});

describe('a delete races an edit in the deleted row', () => {
  const seed = () =>
    room((b) => {
      const s = b.addSheet('Sheet1');
      for (let i = 0; i < 5; i++) s.cell(i, 0, { value: i + 1 });
      s.cell(0, 2, { formula: 'SUM(A2:A4)' });
    });

  it('keeps the edit as an orphan, and the undo brings back the row with it', () => {
    const { room: r, people, sheet } = seed();
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    const a4 = a.engine.sheet(sheet)!.rowOrder[3]!;
    const colA = a.engine.sheet(sheet)!.colOrder[0]!;
    type(b, sheet, 'A4', '100');
    a.deleteRows(sheet, 3, 1);
    // One step: the rows and the formula that reached into them.
    expect(edit(a, sheet, 'C1')).toBe('=SUM(A2:A3)');
    r.flush();

    for (const m of [a, b]) {
      expect(grid(m, sheet, 4, 1).flat()).toEqual(['1', '2', '3', '5']);
      expect(edit(m, sheet, 'C1')).toBe('=SUM(A2:A3)');
      expect(text(m, sheet, 'C1')).toBe('5');
    }
    expect(r.cell(sheet, a4, colA)).toEqual({ v: 100 });

    expect(a.undo()).toBe(true);
    r.flush();
    for (const m of [a, b]) {
      expect(grid(m, sheet, 5, 1).flat()).toEqual(['1', '2', '3', '100', '5']);
      expect(edit(m, sheet, 'C1')).toBe('=SUM(A2:A4)');
      expect(text(m, sheet, 'C1')).toBe('105');
    }
  });

  it('an undo leaves a cell somebody changed since', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    type(a, sheet, 'A1', 'mine');
    r.flush();
    type(b, sheet, 'A1', 'theirs');
    r.flush();
    a.undo();
    r.flush();
    expect(text(a, sheet, 'A1')).toBe('theirs');
    expect(text(b, sheet, 'A1')).toBe('theirs');
  });
});

describe('offline steps replay', () => {
  it('in order, after the snapshot, and both people end the same', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people as [(typeof people)[0], (typeof people)[0]];
    a.client.disconnect();
    type(a.model, sheet, 'A1', '1');
    type(a.model, sheet, 'A1', '2');
    a.model.insertRows(sheet, 0, 1);
    type(a.model, sheet, 'A1', 'top');
    expect(a.model.status()).toMatchObject({ save: 'offline', pending: 4 });
    type(b.model, sheet, 'B5', 'theirs');
    r.flush();
    expect(text(b.model, sheet, 'A1')).toBe('');

    a.client.reconnect();
    r.flush();
    expect(r.log.filter((s) => s.client === 'a').map((s) => s.clientSeq)).toEqual([1, 2, 3, 4]);
    for (const m of [a.model, b.model]) {
      expect(text(m, sheet, 'A1')).toBe('top');
      expect(text(m, sheet, 'A2')).toBe('2');
      expect(text(m, sheet, 'B6')).toBe('theirs');
    }
    expect(a.model.status()).toMatchObject({ save: 'saved', pending: 0 });
    expect(grid(a.model, sheet, 8, 3)).toEqual(grid(b.model, sheet, 8, 3));
  });

  it('a local edit made before the snapshot arrives outlives it', () => {
    const { room: r, people, sheet } = room();
    const [a] = people as [(typeof people)[0]];
    type(a.model, sheet, 'D4', 'before');
    r.flush();
    a.client.disconnect();
    a.client.reconnect();
    // Connected, the snapshot still in the inbox: it holds D4 and not D5.
    a.client.deliver(1);
    type(a.model, sheet, 'D4', 'early');
    type(a.model, sheet, 'D5', 'also');
    r.flush();
    expect(text(a.model, sheet, 'D4')).toBe('early');
    expect(text(a.model, sheet, 'D5')).toBe('also');
    expect(r.log.at(-1)?.client).toBe('a');
  });
});

describe('a snapshot drops what it already holds', () => {
  it('and applies what came after it, once its last part is in', () => {
    const { room: r, people, sheet } = room();
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    type(a, sheet, 'A1', 'old');
    r.flush();
    const stale = r.log.at(-1)!;
    type(a, sheet, 'A1', 'new');
    type(a, sheet, 'A2', 'kept');
    r.flush();

    // Two parts: A1 in the first, A2 in the second.
    const cc = r.client('c', 2);
    const c = new SheetModel(cc.source);
    const snapshot = cc.inbox.findIndex((d) => d.kind === 'frame');
    // b's step lands after c's snapshot was taken, and reaches c before the snapshot's last part.
    type(b, sheet, 'B1', 'later');
    r.process();
    const later = cc.inbox.pop()!;
    cc.inbox.splice(snapshot + 1, 0, later);
    // And a remote the snapshot already holds, as the room may send while it reads the cells.
    const old: CellsFrame = decodeCellsFrame(remoteFrame(stale.seq, new Uint8Array(0), stale.cells))!;
    cc.inbox.splice(snapshot, 0, { kind: 'frame', frame: old });
    expect(cc.inbox.slice(snapshot).map((d) => (d.kind === 'frame' ? d.frame.type : d.kind))).toEqual([
      'remote',
      'snapshot',
      'remote',
      'snapshot'
    ]);

    cc.deliver();
    expect(text(c, sheet, 'A1')).toBe('new');
    expect(text(c, sheet, 'B1')).toBe('later');
    expect(text(c, sheet, 'A2')).toBe('kept');
    r.flush();
    expect(grid(c, sheet, 2, 2)).toEqual(grid(a, sheet, 2, 2));
  });
});

describe('two people move one row at once', () => {
  it('leaves one copy of it, in the document and in both engines', () => {
    const { room: r, people, sheet } = room((b) => {
      const s = b.addSheet('Sheet1', { rows: 8, cols: 2 });
      for (let i = 0; i < 6; i++) s.cell(i, 0, { value: i + 1 });
    });
    const [a, b] = people.map((p) => p.model) as [SheetModel, SheetModel];
    a.move(sheet, 'row', 0, 3, 1);
    b.move(sheet, 'row', 0, 5, 1);
    r.flush();

    const order = rowOrder(a, sheet);
    expect(order).toEqual(rowOrder(b, sheet));
    expect(new Set(order).size).toBe(8);
    expect(order).toHaveLength(8);
    const inRoom = (sheetsOf(r.doc).get(sheet)!.get('rowOrder') as { toArray(): string[] }).toArray();
    expect(inRoom).toEqual(order);
    expect(grid(a, sheet, 8, 1)).toEqual(grid(b, sheet, 8, 1));
    expect(
      grid(a, sheet, 8, 1)
        .flat()
        .filter((t) => t !== '')
        .sort()
    ).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(sheetIdsInOrder(r.doc)).toEqual(sheetOrderOf(r.doc).toArray());
  });
});

describe('positions', () => {
  it('A1 addressing in the helpers', () => {
    expect(at('AB12')).toEqual({ row: 11, col: 27 });
  });
});
