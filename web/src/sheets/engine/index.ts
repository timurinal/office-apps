/**
 * The Sheets formula engine. Pure TypeScript with no DOM and no eval, so the page
 * and the Worker (export, the assistant reading a sheet) compute the same values.
 *
 * The contract with the model:
 *
 *   · A cell is a CellContent: `v` a value, `e` an error code, or `f` a formula in
 *     the stored form (parser.ts), whose references are row and column ids:
 *     =SUM(`$r1.$c1`:`r10.c1`). An insert anywhere leaves it byte for byte unchanged.
 *   · A person types and reads A1. contentFromInput turns typed text into content;
 *     displayFormula prints a stored formula at today's positions.
 *   · Structure is mirrored, not owned: when the model inserts, deletes, sorts or
 *     moves rows or columns, it makes the same call here, then calls recalc().
 *   · A delete rewrites no single reference; it shows #REF! and an undo (the same
 *     ids back) heals it. A range end on a deleted line is moved off it by the
 *     deleting client, which sends planDeleteRows/Cols's writes in the same frame.
 *   · Where typed text or a paste reaches past the grid, the engine answers
 *     { kind: 'grow' } and the model adds rows or columns first.
 */

export { Engine } from './engine';
export type { CellWrite, Clip, DeletePlan, EngineOptions, Growth, InputResult, NameWrite, Rect, SortKey, SortResult, WriteResult } from './engine';
export type { CellContent, Axis } from './sheet';
export { CellError, ERR, type ErrorCode, type Scalar, compare, errorFromLiteral, isError, numberToText } from './values';
export { formatValue, general, isDateFormat, type Formatted } from './format';
export { parseValue, type ParsedInput } from './input';
export { dateToSerial, serialToDate, serialToTime, type DateOrder } from './dates';
export {
  FormulaSyntaxError,
  MAX_COLS,
  MAX_ROWS,
  cellAddress,
  colToLetters,
  lettersToCol,
  parseCellAddress,
  parseStored,
  printStored
} from './parser';
export { OWN_FUNCTIONS, formulajsFunctions, isKnownFunction } from './functions/index';
