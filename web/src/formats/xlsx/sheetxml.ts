/**
 * One worksheet part, read for what ExcelJS must not be given and for what it cannot say.
 *
 * ExcelJS is a fine reader of cells and their formats and a poor one of everything that is
 * stated as a range: it expands a data validation into one entry per cell of its `sqref`, a
 * merge into one cell object per cell it covers, a column definition into one `Column` for
 * each index from `min` to `max`. A file that validates a whole column, which Excel itself
 * writes, makes a million entries; one that says `A1:XFD1048576` makes seventeen billion and
 * never returns. So the parts that are ranges are taken out of the sheet before ExcelJS reads
 * it, and read here, where a range stays a range.
 *
 * What goes, and what happens to it:
 *
 *   mergeCells       read: the rectangles
 *   dataValidations  read, and the `x14:` ones in extLst that Excel writes for a list on another sheet
 *   autoFilter       read: the range, and whether any column has a criterion
 *   cols             kept, with `min` and `max` held to the sheet's columns
 *   hyperlinks       counted. The model has no links, and a link the model cannot hold is not read
 *   tableParts, drawing, legacyDrawing, picture, oleObjects, controls, extLst   counted
 *
 * The work is one pass of the same SAX parser the other converters use, with a DOCTYPE refused
 * and nothing resolved, over the text; elements are cut out by their offsets in it, which is
 * exact because the parser has already found the document well formed.
 */

import { SaxesParser } from 'saxes';
import { FormatError } from '../errors';
import { MAX_COLS, MAX_ROWS, colToLetters, lettersToCol } from '../../sheets/engine';

/** A data validation as the file states it, before any of it is understood. */
export interface RawValidation {
  type: string;
  operator: string;
  allowBlank: boolean;
  /** `showErrorMessage`: without it Excel lets an invalid value stand. */
  showError: boolean;
  errorStyle: string;
  error: string;
  sqref: string;
  formula1: string;
  formula2: string;
}

export interface SheetFacts {
  merges: string[];
  validations: RawValidation[];
  autoFilter: { ref: string; criteria: boolean } | null;
  cells: number;
  /** `<row>` elements, empty ones too. */
  rows: number;
  hyperlinks: number;
  tables: number;
  /** A `<drawing>`: pictures and charts, which this importer does not read. */
  drawings: number;
  /** A `<legacyDrawing>`: the shapes behind comments. */
  notes: number;
  sparklines: number;
  /** Conditional formats stored in extLst, other than data bars, which Excel writes a second time there and ExcelJS has already read. */
  extRules: number;
}

export interface ScannedSheet {
  /** The sheet without the parts above. */
  text: string;
  facts: SheetFacts;
}

const DOCTYPE = /<!\s*(?:DOCTYPE|ENTITY)/i;

const CUT = new Set(['mergeCells', 'dataValidations', 'autoFilter', 'hyperlinks', 'tableParts', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'extLst']);

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

export function scanSheet(text: string): ScannedSheet {
  if (DOCTYPE.test(text)) throw new FormatError('xml_unsafe', 'DOCTYPE or ENTITY declaration');
  const facts: SheetFacts = { merges: [], validations: [], autoFilter: null, cells: 0, rows: 0, hyperlinks: 0, tables: 0, drawings: 0, notes: 0, sparklines: 0, extRules: 0 };
  /** [start, end, replacement]: spans of `text` that do not go through, in document order. */
  const cuts: [number, number, string][] = [];

  const parser = new SaxesParser({ xmlns: true, position: false });
  /** Local names of the open elements. */
  const stack: string[] = [];
  let cutDepth = 0;
  let cutStart = -1;
  let dv: RawValidation | null = null;
  let leaf: 'formula1' | 'formula2' | 'f' | 'sqref' | null = null;
  let leafText = '';
  let inExt = false;
  /** The row and column last seen, for a `<row>` or `<c>` that does not say where it is (the `r` attribute is optional). */
  let rowNumber = 0;
  let colNumber = -1;
  let failure: FormatError | null = null;
  /** A `<col>` with content, rewritten when its element closes. */
  let pendingCol: { start: number; text: string } | null = null;

  parser.on('doctype', () => {
    failure ??= new FormatError('xml_unsafe', 'DOCTYPE event');
  });
  parser.on('error', (e) => {
    failure ??= new FormatError('xml_invalid', e.message);
  });

  parser.on('opentag', (tag) => {
    if (failure) return;
    const name = tag.local;
    const parent = stack[stack.length - 1];
    stack.push(name);
    const attr = (k: string): string => tag.attributes[k]?.value ?? '';

    if (cutDepth === 0 && CUT.has(name) && stack.length === 2) {
      cutStart = text.lastIndexOf('<', parser.position - 1);
      if (tag.isSelfClosing) {
        cuts.push([cutStart, parser.position, '']);
        cutStart = -1;
      } else cutDepth = 1;
      if (name === 'extLst') inExt = true;
      if (name === 'drawing') facts.drawings++;
      if (name === 'legacyDrawing') facts.notes++;
      if (name === 'autoFilter') facts.autoFilter = { ref: attr('ref'), criteria: false };
      return;
    }
    if (cutDepth > 0) {
      cutDepth++;
      if (name === 'hyperlink') facts.hyperlinks++;
      else if (name === 'tablePart') facts.tables++;
      else if (name === 'mergeCell') facts.merges.push(attr('ref'));
      else if (name === 'filterColumn' && facts.autoFilter) facts.autoFilter.criteria = true;
      else if (name === 'dataValidation') {
        dv = {
          type: attr('type') || 'any',
          operator: attr('operator') || 'between',
          allowBlank: attr('allowBlank') === '1' || attr('allowBlank') === 'true',
          showError: attr('showErrorMessage') === '1' || attr('showErrorMessage') === 'true',
          errorStyle: attr('errorStyle') || 'stop',
          error: attr('error'),
          sqref: attr('sqref'),
          formula1: '',
          formula2: ''
        };
        // x14 (extLst) nests the formulas and the range as elements instead.
        if (tag.isSelfClosing) {
          facts.validations.push(dv);
          dv = null;
        }
      } else if (dv && (name === 'formula1' || name === 'formula2')) {
        leaf = name;
        leafText = '';
      } else if (dv && name === 'f' && (parent === 'formula1' || parent === 'formula2')) {
        leaf = parent;
        leafText = '';
      } else if (dv && name === 'sqref') {
        leaf = 'sqref';
        leafText = '';
      } else if (inExt && name === 'sparklineGroup') facts.sparklines++;
      else if (inExt && name === 'cfRule' && attr('type') !== 'dataBar') facts.extRules++;
      return;
    }
    if (name === 'c' && parent === 'row') {
      facts.cells++;
      const at = /^([A-Za-z]{1,3})\d+$/.exec(attr('r'));
      if (at) {
        colNumber = lettersToCol(at[1]!);
        if (colNumber >= MAX_COLS) failure ??= new FormatError('xml_invalid', `a cell in column ${at[1]}`);
      } else {
        // ExcelJS needs the address; the file never had to give it.
        colNumber++;
        const start = text.lastIndexOf('<', parser.position - 1);
        cuts.push([start, start + 1 + tag.name.length, `<${tag.name} r="${colToLetters(colNumber)}${rowNumber}"`]);
      }
    } else if (name === 'row' && parent === 'sheetData') {
      facts.rows++;
      colNumber = -1;
      const given = parseInt(attr('r'), 10);
      if (given > MAX_ROWS) failure ??= new FormatError('xml_invalid', `a row numbered ${given}`);
      if (Number.isInteger(given) && given > 0) rowNumber = given;
      else {
        rowNumber++;
        const start = text.lastIndexOf('<', parser.position - 1);
        cuts.push([start, start + 1 + tag.name.length, `<${tag.name} r="${rowNumber}"`]);
      }
    } else if (name === 'col' && parent === 'cols') {
      // Read the way ExcelJS reads them, which is `parseInt`: "2000000000x" is two billion to it.
      const min = parseInt(attr('min'), 10);
      const max = parseInt(attr('max'), 10);
      if (Number.isFinite(min) && Number.isFinite(max) && (min < 1 || max > MAX_COLS || min > max)) {
        const start = text.lastIndexOf('<', parser.position - 1);
        const end = tag.isSelfClosing ? parser.position : -1;
        const lo = Math.max(1, min);
        const hi = Math.min(MAX_COLS, max);
        if (lo > hi) {
          // Entirely outside the sheet.
          if (end >= 0) cuts.push([start, end, '']);
          else pendingCol = { start, text: '' };
        } else {
          const attrs = Object.values(tag.attributes)
            .map((a) => `${a.name}="${escapeAttr(a.name === 'min' ? String(lo) : a.name === 'max' ? String(hi) : a.value)}"`)
            .join(' ');
          const replaced = `<col ${attrs}/>`;
          if (end >= 0) cuts.push([start, end, replaced]);
          else pendingCol = { start, text: replaced };
        }
      }
    }
  });

  const onText = (t: string) => {
    if (leaf) leafText += t;
  };
  parser.on('text', onText);
  parser.on('cdata', onText);

  parser.on('closetag', () => {
    if (failure) return;
    const name = stack.pop();
    if (pendingCol && name === 'col') {
      cuts.push([pendingCol.start, parser.position, pendingCol.text]);
      pendingCol = null;
    }
    if (cutDepth > 0) {
      if (dv && leaf && (name === 'formula1' || name === 'formula2' || name === 'f' || name === 'sqref')) {
        if (name === 'sqref') dv.sqref = leafText.trim();
        else if (leaf === 'formula1') dv.formula1 = leafText;
        else if (leaf === 'formula2') dv.formula2 = leafText;
        // `xm:f` closes inside `x14:formula1`; the formula1 close that follows has no leaf.
        leaf = null;
      }
      if (dv && name === 'dataValidation') {
        facts.validations.push(dv);
        dv = null;
      }
      cutDepth--;
      if (cutDepth === 0) {
        cuts.push([cutStart, parser.position, '']);
        cutStart = -1;
        inExt = false;
      }
    }
  });

  try {
    parser.write(text).close();
  } catch (e) {
    failure ??= e instanceof FormatError ? e : new FormatError('xml_invalid', String(e));
  }
  if (failure) throw failure;

  if (cuts.length === 0) return { text, facts };
  cuts.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [start, end, replacement] of cuts) {
    out += text.slice(at, start) + replacement;
    at = end;
  }
  out += text.slice(at);
  return { text: out, facts };
}

/** A document without its top-level child `name`, cut out by the parser's own offsets. */
export function withoutChild(text: string, name: string): string {
  if (DOCTYPE.test(text)) throw new FormatError('xml_unsafe', 'DOCTYPE or ENTITY declaration');
  const parser = new SaxesParser({ xmlns: true, position: false });
  let depth = 0;
  let start = -1;
  let cut: [number, number] | null = null;
  let failure: FormatError | null = null;
  parser.on('doctype', () => {
    failure ??= new FormatError('xml_unsafe', 'DOCTYPE event');
  });
  parser.on('error', (e) => {
    failure ??= new FormatError('xml_invalid', e.message);
  });
  parser.on('opentag', (tag) => {
    depth++;
    if (depth === 2 && tag.local === name && !cut) {
      start = text.lastIndexOf('<', parser.position - 1);
      if (tag.isSelfClosing) {
        cut = [start, parser.position];
        start = -1;
      }
    }
  });
  parser.on('closetag', () => {
    if (depth === 2 && start >= 0) {
      cut = [start, parser.position];
      start = -1;
    }
    depth--;
  });
  try {
    parser.write(text).close();
  } catch (e) {
    failure ??= e instanceof FormatError ? e : new FormatError('xml_invalid', String(e));
  }
  if (failure) throw failure;
  return cut ? text.slice(0, cut[0]) + text.slice(cut[1]) : text;
}
