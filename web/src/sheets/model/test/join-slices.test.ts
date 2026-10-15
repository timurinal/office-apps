/**
 * The first join of a big sheet is applied in slices that give the page back between them (model.ts,
 * `applyInSlices`), and says how far it is. What must not change is shared/cells.ts's joining rule: the
 * snapshot, then the frames held over it, then the steps not yet acknowledged, and a sheet that is not
 * loaded does not claim to be.
 */

import { describe, expect, it } from 'vitest';
import { SheetModel } from '../model';
import { buildSheetSeed } from '../seed';
import { estimateMeasure } from '../measure';
import { FakeRoom } from '../testing/fakeRoom';
import { at, text } from './helpers';

/** 6 columns by 5,000 rows, 5 of them filled: 25,000 cells, past the point where a join is sliced. */
const BIG = () =>
  buildSheetSeed((b) => {
    const s = b.addSheet('Data', { rows: 5000, cols: 6 });
    for (let r = 0; r < 5000; r++) for (let c = 0; c < 5; c++) s.cell(r, c, { value: r * 10 + c });
  });

/** Turns of the event loop until `done`. A sliced application is one turn per slice. */
async function turns(done: () => boolean, max = 5000): Promise<number> {
  let n = 0;
  while (!done() && n < max) {
    await new Promise((r) => setTimeout(r, 0));
    n++;
  }
  return n;
}

const joinedModel = (room: FakeRoom, parts = 4, name = 'a') => {
  const client = room.client(name, parts);
  const model = new SheetModel(client.source, { measure: estimateMeasure() });
  return { client, model };
};

describe('joining a big sheet', () => {
  it('takes the cells in over several turns, and says how far it is', async () => {
    const room = new FakeRoom(BIG());
    const { client, model } = joinedModel(room);
    expect(model.status().progress).toBeNull(); // nothing has come yet

    client.deliver(3); // connected, the structure, synced
    expect(model.status().progress).toBe(0);
    const seen: number[] = [];
    while (client.inbox.length > 1) {
      client.deliver(1);
      seen.push(model.status().progress!);
    }
    // Parts arriving: a share of the first 80%.
    expect(seen.map((x) => Math.round(x * 100) / 100)).toEqual([0.2, 0.4, 0.6]);

    client.deliver(1); // the last part
    expect(model.status().loaded).toBe(false);
    expect(model.status().progress).toBeGreaterThanOrEqual(0.8);

    const waited = await turns(() => model.status().loaded);
    expect(waited, 'one turn for each slice').toBeGreaterThan(1);
    expect(model.status().loaded).toBe(true);
    expect(model.status().progress).toBeNull();
    expect(model.status().cells).toBe(25_000);
    const sheet = model.sheets()[0]!.id;
    expect(text(model, sheet, 'A1')).toBe('0');
    expect(text(model, sheet, 'E5000')).toBe(String(4999 * 10 + 4));
  });

  it('holds what arrives meanwhile, and applies it over the snapshot in order', async () => {
    const room = new FakeRoom(BIG());
    // b is in, and loaded.
    const b = joinedModel(room, 1, 'b');
    b.client.deliver();
    await turns(() => b.model.status().loaded);
    const sheet = b.model.sheets()[0]!.id;
    // a joins: its snapshot is cut now, and nothing is delivered to it yet.
    const a = joinedModel(room, 3, 'a');
    // b edits after the cut: the room sends both to a as remotes, behind the snapshot's parts.
    b.model.input(sheet, at('A1'), '111');
    b.model.input(sheet, at('B2'), '222');
    room.process();

    // Everything is delivered at once: the last part starts the slices, and the two remotes arrive while they run.
    a.client.deliver();
    expect(a.model.status().loaded).toBe(false);
    await turns(() => a.model.status().loaded);
    const asheet = a.model.sheets()[0]!.id;
    expect(text(a.model, asheet, 'A1')).toBe('111');
    expect(text(a.model, asheet, 'B2')).toBe('222');
    expect(text(a.model, asheet, 'C3')).toBe(String(2 * 10 + 2));
  });

  it('leaves a half-applied snapshot when the socket drops, and takes the next one whole', async () => {
    const room = new FakeRoom(BIG());
    // b is in, and will change a cell while a is away.
    const b = joinedModel(room, 1, 'b');
    b.client.deliver();
    await turns(() => b.model.status().loaded);
    const bsheet = b.model.sheets()[0]!.id;

    const a = joinedModel(room, 2, 'a');
    // The first slice runs inside this call, and the rest wait for the page: the socket drops with most still to do.
    a.client.deliver();
    expect(a.model.status().loaded).toBe(false);
    a.client.disconnect();
    expect(a.model.status().loaded).toBe(false);

    // While it is gone, the room moves on: this is in the snapshot a is about to be sent, and in no step it holds. It
    // is the last cell, which the abandoned application had not reached when the socket dropped.
    b.model.input(bsheet, at('E5000'), '999');
    room.process();
    a.client.reconnect();
    a.client.deliver();
    await turns(() => a.model.status().loaded);
    // Time for an application that was not abandoned to reach the end of its cells and write them over the new ones.
    await turns(() => false, 300);

    // The abandoned application did not finish over the new join and take its place: the new snapshot was read.
    const asheet = a.model.sheets()[0]!.id;
    expect(a.model.status().cells).toBe(25_000);
    expect(text(a.model, asheet, 'E5000')).toBe('999');
    expect(text(a.model, asheet, 'D4000')).toBe(String(3999 * 10 + 3));
  });

  it('reads one snapshot, and not a second that arrives while the first is being taken in', async () => {
    const room = new FakeRoom(BIG());
    const { client, model } = joinedModel(room, 2);
    const sheet = () => model.sheets()[0]!.id;
    client.deliver();
    expect(model.status().loaded).toBe(false);
    // A snapshot the room never sends twice, with a cell of its own, behind the cells being applied.
    const stray = room.cells.values().next().value!;
    client.inbox.push({
      kind: 'frame',
      frame: { type: 'snapshot', seq: room.seq, part: 1, parts: 2, cells: [{ ...stray, content: { v: 'stray' } }] }
    });
    client.deliver();
    await turns(() => model.status().loaded);
    expect(model.status().cells).toBe(25_000);
    expect(text(model, sheet(), 'A1')).toBe('0');
  });

  it('does not touch a model that went away while the slices ran', async () => {
    const room = new FakeRoom(BIG());
    const { client, model } = joinedModel(room, 2);
    client.deliver();
    model.destroy();
    await turns(() => false, 40);
    expect(model.status().loaded).toBe(false);
  });

  it('applies a small snapshot at once, as before', () => {
    const room = new FakeRoom(
      buildSheetSeed((b) => {
        const s = b.addSheet('Data', { rows: 50, cols: 4 });
        for (let r = 0; r < 50; r++) s.cell(r, 0, { value: r });
      })
    );
    const { client, model } = joinedModel(room, 2);
    client.deliver();
    expect(model.status().loaded).toBe(true);
    expect(model.status().cells).toBe(50);
  });
});
