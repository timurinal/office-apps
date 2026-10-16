/**
 * The fill handle's text series, as Excel's: day and month names, quarters, and text that ends in a
 * number. Each answers the text `i` steps on from the first cell, `i` negative when filling back.
 */

const LISTS = [
  ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
];

const QUARTER = /^(q|qtr|quarter)(\s*)([1-4])$/i;
const NUMBERED = /^(.*?)(\d{1,15})$/;

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** The one step between each pair of neighbours, counted round a list of `n` when there is one. */
function stepOf(xs: number[], n?: number): number | null {
  if (xs.length < 2) return 1;
  const d = (i: number) => (n ? mod(xs[i]! - xs[i - 1]!, n) : xs[i]! - xs[i - 1]!);
  for (let i = 2; i < xs.length; i++) if (d(i) !== d(1)) return null;
  return d(1);
}

/** A name in the first cell's case: MON, Mon or mon. */
function cased(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]!.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/** Null when the texts are not one series, and the handle copies them instead. */
export function textSeries(texts: string[]): ((i: number) => string) | null {
  const first = texts[0]!;
  const lower = texts.map((t) => t.toLowerCase());
  for (const list of LISTS) {
    const at = lower.map((t) => list.indexOf(t));
    if (at.some((x) => x < 0)) continue;
    const step = stepOf(at, list.length);
    if (step === null) return null;
    return (i) => cased(list[mod(at[0]! + step * i, list.length)]!, first);
  }
  const quarters = texts.map((t) => QUARTER.exec(t));
  if (quarters.every((m) => m && m[1]!.toLowerCase() + m[2] === quarters[0]![1]!.toLowerCase() + quarters[0]![2])) {
    const at = quarters.map((m) => Number(m![3]) - 1);
    const step = stepOf(at, 4);
    if (step === null) return null;
    const head = quarters[0]![1]! + quarters[0]![2]!;
    return (i) => `${head}${mod(at[0]! + step * i, 4) + 1}`;
  }
  const numbered = texts.map((t) => NUMBERED.exec(t));
  if (numbered.every((m) => m && m[1] === numbered[0]![1])) {
    const at = numbered.map((m) => Number(m![2]));
    const step = stepOf(at);
    if (step === null) return null;
    const [, head, digits] = numbered[0]!;
    // Below nought it counts up again, as Excel's does, rather than writing a minus into the text.
    return (i) => `${head}${String(Math.abs(at[0]! + step * i)).padStart(digits!.length, '0')}`;
  }
  return null;
}
