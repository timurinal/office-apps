import { describe, expect, it } from 'vitest';
import type { CellError } from '../values';
import { Book, err } from './book';

function book(): Book {
  const b = new Book({ Sheet1: [10, 4], 'Q3 Plan': [5, 2] });
  for (let i = 1; i <= 5; i++) b.input('Sheet1', `A${i}`, String(i));
  b.input('Sheet1', 'B1', '=SUM(A2:A4)'); // 9
  b.input('Sheet1', 'B2', '=A5*10'); // 50
  b.input('Sheet1', 'B3', "=SUM($A$1:A5)+'Q3 Plan'!A1"); // 15 + 7
  b.input('Q3 Plan', 'A1', '7');
  b.e.recalc();
  return b;
}

describe('stable ids', () => {
  it('takes A1 in, stores ids, and shows A1 back', () => {
    const b = book();
    expect(b.formula('Sheet1', 'B3')).toBe("=SUM($A$1:A5)+'Q3 Plan'!A1");
    expect(b.stored('Sheet1', 'B3')).toMatch(/^=SUM\(`\$r\w+\.\$c\w+`:`r\w+\.c\w+`\)\+`s\w+!r\w+\.c\w+`$/);
    expect(b.get('Sheet1', 'B3')).toBe(22);
  });

  it('inserting rows above a range changes no stored formula and no value', () => {
    const b = book();
    const before = b.allStored('Sheet1');
    b.insertRows('Sheet1', 0, 2);
    b.e.recalc();
    expect(b.allStored('Sheet1')).toEqual(before);
    expect(b.formula('Sheet1', 'B3')).toBe('=SUM(A4:A6)');
    expect(b.formula('Sheet1', 'B4')).toBe('=A7*10');
    expect(b.formula('Sheet1', 'B5')).toBe("=SUM($A$3:A7)+'Q3 Plan'!A1");
    expect(b.get('Sheet1', 'B3')).toBe(9);
    expect(b.get('Sheet1', 'B4')).toBe(50);
  });

  it('a row inserted inside a range grows it; one inserted just below does not', () => {
    const b = book();
    b.insertRows('Sheet1', 2, 1); // between A2 and A3
    b.input('Sheet1', 'A3', '100');
    b.insertRows('Sheet1', 5, 1); // between the old A4 (now A5) and A5 (now A7)
    b.input('Sheet1', 'A6', '1000');
    b.e.recalc();
    expect(b.formula('Sheet1', 'B1')).toBe('=SUM(A2:A5)');
    expect(b.get('Sheet1', 'B1')).toBe(109);
    expect(b.formula('Sheet1', 'B2')).toBe('=A7*10');
    expect(b.get('Sheet1', 'B2')).toBe(50);
  });

  it('inserting an empty row inside a range recalculates what counts positions', () => {
    const b = book();
    b.input('Sheet1', 'D1', '=COUNTBLANK(A1:A5)');
    b.input('Sheet1', 'D2', '=ROWS(A1:A5)');
    b.e.recalc();
    expect([b.get('Sheet1', 'D1'), b.get('Sheet1', 'D2')]).toEqual([0, 5]);
    b.insertRows('Sheet1', 2, 1);
    b.e.recalc();
    expect([b.get('Sheet1', 'D1'), b.get('Sheet1', 'D2')]).toEqual([1, 6]);
  });

  it('inserting a column changes no stored formula', () => {
    const b = book();
    const before = b.allStored('Sheet1');
    b.insertCols('Sheet1', 0, 1);
    b.e.recalc();
    expect(b.allStored('Sheet1')).toEqual(before);
    expect(b.formula('Sheet1', 'C3')).toBe("=SUM($B$1:B5)+'Q3 Plan'!A1");
    expect(b.get('Sheet1', 'C3')).toBe(22);
  });

  it('deleting a referenced row gives #REF!, and an undo (the same id back) restores it', () => {
    const b = book();
    const s = b.sheet('Sheet1');
    const a5 = s.rowOrder[4]!;
    b.deleteRows('Sheet1', 4, 1);
    b.e.recalc();
    expect(b.formula('Sheet1', 'B2')).toBe('=#REF!*10');
    expect(err(b.get('Sheet1', 'B2'))).toBe('#REF!');
    expect(b.formula('Sheet1', 'B3')).toBe("=SUM($A$1:A4)+'Q3 Plan'!A1"); // the deleted range end moved up
    expect(b.get('Sheet1', 'B3')).toBe(17);
    // Undo: the model re-inserts the same id; the engine kept its cells.
    b.e.insertRows(s.id, 4, [a5]);
    b.e.recalc();
    expect(b.formula('Sheet1', 'B2')).toBe('=A5*10');
    expect(b.get('Sheet1', 'B2')).toBe(50);
    expect(b.get('Sheet1', 'A5')).toBe(5);
  });

  it('deleting the first or every row of a range', () => {
    const b = book();
    b.deleteRows('Sheet1', 1, 1); // A2, the start of A2:A4
    b.e.recalc();
    expect(b.formula('Sheet1', 'B1')).toBe('=SUM(A2:A3)');
    expect(b.get('Sheet1', 'B1')).toBe(7);
    b.deleteRows('Sheet1', 1, 2); // the rest of it
    b.e.recalc();
    expect(b.formula('Sheet1', 'B1')).toBe('=SUM(#REF!)');
    expect(err(b.get('Sheet1', 'B1'))).toBe('#REF!');
  });

  it('deleting rows in the middle of a range shrinks it with no rewrite', () => {
    const b = book();
    const before = b.stored('Sheet1', 'B1');
    const plan = b.e.planDeleteRows(b.sheet('Sheet1').id, 2, 1); // A3, inside A2:A4
    expect(plan.cells.find((w) => w.content?.f === before)).toBeUndefined();
    b.deleteRows('Sheet1', 2, 1);
    b.e.recalc();
    expect(b.stored('Sheet1', 'B1')).toBe(before);
    expect(b.formula('Sheet1', 'B1')).toBe('=SUM(A2:A3)');
    expect(b.get('Sheet1', 'B1')).toBe(6);
  });

  it('deleting a column a formula reads, and the formula column itself', () => {
    const b = book();
    b.input('Sheet1', 'C1', '=B2+1');
    b.e.recalc();
    expect(b.get('Sheet1', 'C1')).toBe(51);
    b.deleteCols('Sheet1', 0, 1); // A: B1..B3 read it, and they are now A1..A3
    b.e.recalc();
    expect(b.formula('Sheet1', 'A2')).toBe('=#REF!*10');
    expect(err(b.get('Sheet1', 'A2'))).toBe('#REF!');
    expect(err(b.get('Sheet1', 'B1'))).toBe('#REF!'); // C1 is B1 now, and reads the error
    b.deleteCols('Sheet1', 0, 1); // the formulas themselves go
    b.e.recalc();
    expect(b.formula('Sheet1', 'A1')).toBe('=#REF!+1');
  });

  it('renaming a sheet changes how a formula reads, not what it stores', () => {
    const b = book();
    const before = b.allStored('Sheet1');
    b.e.renameSheet(b.sheet('Q3 Plan').id, 'Budget');
    expect(b.formula('Sheet1', 'B3')).toBe('=SUM($A$1:A5)+Budget!A1');
    expect(b.allStored('Sheet1')).toEqual(before);
  });

  it('removing a sheet gives #REF!, and adding it back heals', () => {
    const b = book();
    const q = b.sheet('Q3 Plan');
    const [rows, cols] = [[...q.rowOrder], [...q.colOrder]];
    b.e.removeSheet(q.id);
    b.e.recalc();
    expect(err(b.get('Sheet1', 'B3'))).toBe('#REF!');
    expect(b.formula('Sheet1', 'B3')).toBe('=SUM($A$1:A5)+#REF!');
    b.e.addSheet(q.id, 'Q3 Plan', rows, cols);
    b.e.setCell(q.id, rows[0]!, cols[0]!, { v: 8 });
    b.e.recalc();
    expect(b.get('Sheet1', 'B3')).toBe(23);
  });

  it('a moved row takes its cells along, and references follow them', () => {
    const b = new Book({ S: [5, 3] });
    for (let i = 1; i <= 5; i++) b.input('S', `A${i}`, String(i));
    b.input('S', 'B1', '=SUM(A1:A3)');
    b.input('S', 'B2', '=A5');
    b.input('S', 'C1', '=ROW()');
    b.e.recalc();
    const s = b.sheet('S');
    const [r1, r2, r3, r4, r5] = s.rowOrder as [string, string, string, string, string];
    b.e.setOrder(s.id, 'rows', [r5, r1, r2, r3, r4]); // row 5 to the top
    b.e.recalc();
    expect(b.formula('S', 'B2')).toBe('=SUM(A2:A4)');
    expect(b.get('S', 'B2')).toBe(6);
    expect(b.formula('S', 'B3')).toBe('=A1');
    expect(b.get('S', 'B3')).toBe(5);
    expect(b.get('S', 'C2')).toBe(2);
  });

  // Phase 4 settled sort as Excel and Google Sheets have it, which this test used to leave open:
  // the contents move and the rows stay. A permutation of the row order would make every
  // reference follow its data, so a total below the block would keep pointing at the same
  // numbers wherever they went, which is not what anyone who has sorted a sheet expects.
  it('a sort moves contents and keeps rows: references from outside keep their positions', () => {
    const b = new Book({ S: [4, 3] });
    ['30', '10', '20'].forEach((v, i) => b.input('S', `A${i + 1}`, v));
    b.input('S', 'B1', '=A1*2'); // inside the block: moves with its row, shifted like a copy
    b.input('S', 'C1', '=A1'); // outside: keeps reading A1, whatever lands there
    b.input('S', 'A4', '=SUM(A1:A2)');
    b.e.recalc();
    const s = b.sheet('S');
    const rows = [...s.rowOrder];
    let from: number[] = [];
    b.apply(() => {
      const r = b.e.sort(s.id, { r1: 0, r2: 2, c1: 0, c2: 1 }, [{ col: 0 }]);
      if (r.kind === 'cells') from = r.from;
      return r;
    });
    b.e.recalc();
    expect(from).toEqual([1, 2, 0]);
    expect(s.rowOrder).toEqual(rows);
    expect([b.get('S', 'A1'), b.get('S', 'A2'), b.get('S', 'A3')]).toEqual([10, 20, 30]);
    expect(b.formula('S', 'B3')).toBe('=A3*2');
    expect(b.get('S', 'B3')).toBe(60);
    expect(b.get('S', 'B1')).toBe(null); // row 1 took row 2's contents, and B2 was empty
    expect(b.formula('S', 'C1')).toBe('=A1');
    expect(b.get('S', 'C1')).toBe(10);
    expect(b.formula('S', 'A4')).toBe('=SUM(A1:A2)');
    expect(b.get('S', 'A4')).toBe(30);
  });

  it('sorts blanks last both ways, and numbers before text before logicals before errors', () => {
    const b = new Book({ S: [6, 1] });
    ['b', '', '2', 'TRUE', '#N/A', 'A'].forEach((v, i) => v && b.input('S', `A${i + 1}`, v));
    b.e.recalc();
    const s = b.sheet('S');
    const read = () => [1, 2, 3, 4, 5, 6].map((i) => err(b.get('S', `A${i}`)));
    b.apply(() => b.e.sort(s.id, { r1: 0, r2: 5, c1: 0, c2: 0 }, [{ col: 0 }]));
    b.e.recalc();
    expect(read()).toEqual([2, 'A', 'b', true, '#N/A', null]);
    b.apply(() => b.e.sort(s.id, { r1: 0, r2: 5, c1: 0, c2: 0 }, [{ col: 0, descending: true }]));
    b.e.recalc();
    expect(read()).toEqual(['#N/A', true, 'b', 'A', 2, null]);
  });

  it('a cell set on a row the engine has not seen yet waits for it', () => {
    const b = new Book({ S: [2, 2] });
    const s = b.sheet('S');
    b.input('S', 'A1', '=SUM(A2:A3)');
    b.e.setCell(s.id, 'later', s.colOrder[0]!, { v: 5 }); // the cell op arrived before the row
    b.e.recalc();
    expect(b.get('S', 'A1')).toBe(0);
    b.e.insertRows(s.id, 2, ['later']); // between A2 and A3, so inside the range
    b.e.recalc();
    expect(b.get('S', 'A3')).toBe(5);
    expect(b.get('S', 'A1')).toBe(5);
  });

  it('asks the model to grow the grid for a reference past its edge', () => {
    const b = new Book({ S: [10, 3] });
    const s = b.sheet('S');
    const r = b.e.contentFromInput(s.id, '=SUM(A1:A50)+E3');
    expect(r).toEqual({ kind: 'grow', sheets: [{ sheetId: s.id, rows: 50, cols: 5 }] });
    b.input('S', 'B1', '=SUM(A1:A50)+E3');
    expect(s.rowOrder.length).toBe(50);
    expect(b.formula('S', 'B1')).toBe('=SUM(A1:A50)+E3');
  });
});

describe('names', () => {
  it('reads, follows a redefinition, and shrinks with a delete', () => {
    const b = book();
    b.define('Top', 'Sheet1!$A$1:$A$3');
    b.input('Sheet1', 'C1', '=SUM(Top)');
    b.e.recalc();
    expect(b.get('Sheet1', 'C1')).toBe(6);
    expect(b.e.displayName('Top')).toBe('=Sheet1!$A$1:$A$3');
    b.define('Top', 'Sheet1!$A$1:$A$5');
    b.e.recalc();
    expect(b.get('Sheet1', 'C1')).toBe(15);
    b.input('Sheet1', 'A2', '20'); // the new definition's range is listened to
    b.e.recalc();
    expect(b.get('Sheet1', 'C1')).toBe(33);
    b.deleteRows('Sheet1', 4, 1);
    b.e.recalc();
    expect(b.e.displayName('Top')).toBe('=Sheet1!$A$1:$A$4');
    expect(b.get('Sheet1', 'C1')).toBe(28);
    b.e.setName('Top', undefined, null);
    b.e.recalc();
    expect(err(b.get('Sheet1', 'C1'))).toBe('#NAME?');
  });

  it('refuses a name that reads as a cell', () => {
    const b = book();
    expect(b.e.nameFromInput('AB12', undefined, '1').kind).toBe('error');
    expect(b.e.nameFromInput('Tax_rate', undefined, '0.2').kind).toBe('content');
  });

  it('a name that reads itself is circular', () => {
    const b = book();
    b.define('Loop', 'Loop+1');
    b.input('Sheet1', 'C1', '=Loop');
    b.e.recalc();
    expect((b.get('Sheet1', 'C1') as CellError).detail).toBe('Circular dependency');
  });
});

describe('copy, paste and fill', () => {
  it('fill down shifts relative parts and keeps absolute ones', () => {
    const b = new Book({ S: [10, 4] });
    for (let i = 1; i <= 5; i++) b.input('S', `A${i}`, String(i));
    b.input('S', 'B1', '=A1*$A$1+A$1');
    const s = b.sheet('S');
    b.apply(() => b.e.fill(s.id, { r1: 0, r2: 0, c1: 1, c2: 1 }, { r1: 0, r2: 4, c1: 1, c2: 1 }));
    b.e.recalc();
    expect(b.formula('S', 'B5')).toBe('=A5*$A$1+A$1');
    expect([1, 2, 3, 4, 5].map((i) => b.get('S', `B${i}`))).toEqual([2, 3, 4, 5, 6]);
  });

  it('fill right, and fill up past the first row gives #REF!', () => {
    const b = new Book({ S: [10, 6] });
    b.input('S', 'A2', '=A1+$A1');
    const s = b.sheet('S');
    b.apply(() => b.e.fill(s.id, { r1: 1, r2: 1, c1: 0, c2: 0 }, { r1: 1, r2: 1, c1: 0, c2: 2 }));
    expect(b.formula('S', 'C2')).toBe('=C1+$A1');
    b.apply(() => b.e.fill(s.id, { r1: 1, r2: 1, c1: 0, c2: 0 }, { r1: 0, r2: 1, c1: 0, c2: 0 }));
    expect(b.formula('S', 'A1')).toBe('=#REF!+#REF!');
  });

  it('fill repeats a block of values and formulas', () => {
    const b = new Book({ S: [10, 2] });
    b.input('S', 'A1', 'x');
    b.input('S', 'A2', '=ROW()');
    const s = b.sheet('S');
    b.apply(() => b.e.fill(s.id, { r1: 0, r2: 1, c1: 0, c2: 0 }, { r1: 0, r2: 5, c1: 0, c2: 0 }));
    b.e.recalc();
    expect([1, 2, 3, 4, 5, 6].map((i) => b.get('S', `A${i}`))).toEqual(['x', 2, 'x', 4, 'x', 6]);
  });

  it('paste to another sheet rebinds unqualified references and keeps qualified ones', () => {
    const b = new Book({ One: [5, 3], Two: [5, 3] });
    b.input('One', 'A1', '1');
    b.input('Two', 'A1', '100');
    b.input('One', 'B1', '=A1+One!A1');
    const clip = b.e.copy(b.sheet('One').id, { r1: 0, r2: 0, c1: 1, c2: 1 });
    b.apply(() => b.e.paste(clip, b.sheet('Two').id, 0, 1));
    b.e.recalc();
    expect(b.formula('Two', 'B1')).toBe('=A1+One!A1');
    expect(b.get('Two', 'B1')).toBe(101);
  });

  it('a cut moves what lies wholly inside it, from any sheet, and leaves the rest', () => {
    const b = new Book({ One: [10, 5], Two: [10, 5] });
    const one = b.sheet('One').id;
    const two = b.sheet('Two').id;
    b.input('One', 'C1', '=A1+SUM(A1:A2)+SUM(A1:A3)+$A$2');
    b.input('Two', 'A1', '=One!A1');
    // A1:A2 cut and pasted at B5.
    const move = { sheetId: one, rect: { r1: 0, r2: 1, c1: 0, c2: 0 }, toSheetId: one, dr: 4, dc: 1 };
    b.set('One', 'C1', { f: b.e.movedFormula(b.stored('One', 'C1')!, one, move)! });
    b.set('Two', 'A1', { f: b.e.movedFormula(b.stored('Two', 'A1')!, two, move)! });
    expect(b.formula('One', 'C1')).toBe('=B5+SUM(B5:B6)+SUM(A1:A3)+$B$6');
    expect(b.formula('Two', 'A1')).toBe('=One!B5');
    // A moved cell's own formula, landing on another sheet, names the sheet it still reads.
    b.input('One', 'D1', '=A3+A1');
    const own = b.e.movedFormula(b.stored('One', 'D1')!, one, { ...move, toSheetId: two }, two)!;
    b.set('Two', 'B1', { f: own });
    expect(b.formula('Two', 'B1')).toBe('=One!A3+B5');
    expect(b.e.movedFormula('=1+2', one, move)).toBeNull();
    expect(b.e.movedFormula(b.stored('One', 'C1')!, two, move)).toBeNull();
  });

  it('paste past the edge asks for more rows first', () => {
    const b = new Book({ S: [3, 2] });
    b.input('S', 'A1', '=B1');
    const s = b.sheet('S');
    const clip = b.e.copy(s.id, { r1: 0, r2: 0, c1: 0, c2: 0 });
    expect(b.e.paste(clip, s.id, 5, 0).kind).toBe('grow');
    b.apply(() => b.e.paste(clip, s.id, 5, 0));
    expect(b.formula('S', 'A6')).toBe('=B6');
  });
});

describe('cycles', () => {
  it('are an error that names itself, and clear when the cycle is broken', () => {
    const b = book();
    b.input('Sheet1', 'D1', '=D2+1');
    b.input('Sheet1', 'D2', '=D1+1');
    b.input('Sheet1', 'D3', '=D1*2');
    b.input('Sheet1', 'D4', '=D4');
    b.input('Sheet1', 'D5', '=SUM(D6:D7)');
    b.input('Sheet1', 'D6', '=D5');
    b.e.recalc();
    for (const a of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']) expect(err(b.get('Sheet1', a)), a).toBe('#REF!');
    expect((b.get('Sheet1', 'D1') as CellError).detail).toBe('Circular dependency');
    b.input('Sheet1', 'D2', '5');
    b.input('Sheet1', 'D6', '4');
    b.e.recalc();
    expect(b.get('Sheet1', 'D1')).toBe(6);
    expect(b.get('Sheet1', 'D3')).toBe(12);
    expect(b.get('Sheet1', 'D5')).toBe(4);
  });

  it('do not stop the rest of the sheet', () => {
    const b = book();
    b.input('Sheet1', 'D1', '=D1');
    b.input('Sheet1', 'D2', '=B1*2');
    b.input('Sheet1', 'A2', '3');
    b.e.recalc();
    expect(b.get('Sheet1', 'D2')).toBe(20);
  });

  it('a long chain does not overflow the stack', () => {
    const n = 20_000;
    const b = new Book({ S: [n, 1] });
    const s = b.sheet('S');
    b.e.setCell(s.id, s.rowOrder[0]!, s.colOrder[0]!, { v: 1 });
    for (let i = 1; i < n; i++) b.e.setCell(s.id, s.rowOrder[i]!, s.colOrder[0]!, { f: `=\`${s.rowOrder[i - 1]}.${s.colOrder[0]}\`+1` });
    b.e.recalc();
    expect(b.get('S', `A${n}`)).toBe(n);
    b.e.setCell(s.id, s.rowOrder[0]!, s.colOrder[0]!, { f: `=\`${s.rowOrder[n - 1]}.${s.colOrder[0]}\`` });
    b.e.recalc();
    expect(err(b.get('S', `A${n}`))).toBe('#REF!');
  });
});

describe('recalculation', () => {
  it('runs only what depends on a change', () => {
    const b = new Book({ S: [1000, 3] });
    for (let i = 1; i <= 1000; i++) {
      b.input('S', `A${i}`, String(i));
      b.input('S', `B${i}`, `=A${i}*2`);
    }
    b.input('S', 'C1', '=SUM(B:B)');
    b.e.recalcAll();
    expect(b.get('S', 'C1')).toBe(1001000);
    b.input('S', 'A500', '0');
    expect(b.e.recalc()).toBe(2); // B500 and C1
    expect(b.get('S', 'C1')).toBe(1000000);
    expect(b.e.recalc()).toBe(0);
  });

  it('volatile functions run every pass, with the injected clock and generator', () => {
    let ms = Date.UTC(2024, 0, 15, 6, 0, 0);
    let rnd = 0.25;
    const b = new Book({ S: [5, 3] }, { now: () => ms, random: () => rnd, timeZone: 'Europe/London' });
    b.input('S', 'A1', '=TODAY()');
    b.input('S', 'A2', '=NOW()');
    b.input('S', 'A3', '=RAND()');
    b.input('S', 'A4', '=RANDBETWEEN(1,4)');
    b.input('S', 'B1', '=A3*2'); // not volatile itself, but reads one
    b.input('S', 'C1', '1');
    expect(b.e.recalc()).toBe(5);
    expect(b.get('S', 'A1')).toBe(45306);
    expect(b.get('S', 'A2')).toBe(45306.25);
    expect(b.get('S', 'A3')).toBe(0.25);
    expect(b.get('S', 'A4')).toBe(2); // 1 + floor(0.25 * 4)
    expect(b.get('S', 'B1')).toBe(0.5);
    ms += 86_400_000;
    rnd = 0.75;
    expect(b.e.recalc()).toBe(5);
    expect(b.get('S', 'A1')).toBe(45307);
    expect(b.get('S', 'A4')).toBe(4);
    expect(b.get('S', 'B1')).toBe(1.5);
  });

  it('TODAY follows the workbook time zone', () => {
    const ms = Date.UTC(2024, 0, 15, 23, 30, 0);
    const utc = new Book({ S: [1, 1] }, { now: () => ms, timeZone: 'UTC' });
    const tokyo = new Book({ S: [1, 1] }, { now: () => ms, timeZone: 'Asia/Tokyo' });
    for (const b of [utc, tokyo]) {
      b.input('S', 'A1', '=TODAY()');
      b.e.recalc();
    }
    expect(utc.get('S', 'A1')).toBe(45306);
    expect(tokyo.get('S', 'A1')).toBe(45307);
  });

  it('ROW and COLUMN recalculate on a structural change', () => {
    const b = new Book({ S: [5, 3] });
    b.input('S', 'B3', '=ROW()*10+COLUMN()');
    b.e.recalc();
    expect(b.get('S', 'B3')).toBe(32);
    b.insertRows('S', 0, 1);
    b.insertCols('S', 0, 1);
    b.e.recalc();
    expect(b.get('S', 'C4')).toBe(43);
  });

  it('a range with a computed end is recalculated every pass', () => {
    const b = new Book({ S: [5, 3] });
    for (let i = 1; i <= 5; i++) b.input('S', `A${i}`, String(i));
    b.input('S', 'B1', '3');
    b.input('S', 'C1', '=SUM(A1:INDEX(A1:A5,B1))');
    b.e.recalc();
    expect(b.get('S', 'C1')).toBe(6);
    b.input('S', 'A5', '50'); // outside A1:A3, but inside what INDEX could reach
    b.input('S', 'B1', '5');
    b.e.recalc();
    expect(b.get('S', 'C1')).toBe(60);
  });

  it('a stored formula that does not parse is #NAME?, not a crash', () => {
    const b = new Book({ S: [2, 2] });
    b.set('S', 'A1', { f: '=SUM(' });
    b.set('S', 'A2', { f: '=A1+1' }); // A1 in A1 is not a stored reference
    b.e.recalc();
    expect(err(b.get('S', 'A1'))).toBe('#NAME?');
    expect(err(b.get('S', 'A2'))).toBe('#NAME?');
  });

  it('a stored name that does not parse is #NAME? where it is read', () => {
    const b = new Book({ S: [2, 2] });
    b.e.setName('Broken', undefined, '=SUM(');
    b.input('S', 'A1', '=Broken+1');
    b.e.recalc();
    expect(err(b.get('S', 'A1'))).toBe('#NAME?');
  });

  it('an error cell from the model', () => {
    const b = new Book({ S: [2, 2] });
    b.set('S', 'A1', { e: '#N/A' });
    b.input('S', 'A2', '=ISNA(A1)');
    b.e.recalc();
    expect(b.get('S', 'A2')).toBe(true);
  });
});
