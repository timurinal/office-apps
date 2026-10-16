/**
 * A chart element as a chart part (`c:chartSpace`) and the small workbook behind it.
 *
 * The part carries the values it shows (the cache PowerPoint draws from) and formulas into the
 * workbook, laid out the way PowerPoint lays one out: categories down column A, a series per
 * column from B, the series' names in row 1. With the workbook beside it "Edit data" works.
 */

import { strToU8, zipSync } from 'fflate';
import type { ChartElement } from '../../slides/model/deck';
import { asColor, el, esc, NS_A, NS_C, NS_R, solidFill, XML_DECL } from './xmlOut';

type Data = Pick<ChartElement, 'chart' | 'categories' | 'series' | 'title'>;

const MAX = 1000;

/** `A`, `B`, ... `AA`. */
function col(n: number): string {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function norm(c: Data): { cats: string[]; series: { name: string; values: number[]; color: ReturnType<typeof asColor> }[] } | null {
  const series = (Array.isArray(c.series) ? c.series : []).slice(0, 50).map((s, i) => ({
    name: typeof s?.name === 'string' && s.name !== '' ? s.name : `Series ${i + 1}`,
    values: (Array.isArray(s?.values) ? s.values : []).slice(0, MAX).map(num),
    color: s?.color !== undefined ? asColor(s.color) : null
  }));
  if (series.length === 0) return null;
  const n = Math.max(Array.isArray(c.categories) ? c.categories.length : 0, ...series.map((s) => s.values.length));
  if (n === 0) return null;
  const cats = Array.from({ length: Math.min(n, MAX) }, (_, i) => String(c.categories?.[i] ?? i + 1));
  for (const s of series) while (s.values.length < cats.length) s.values.push(0);
  return { cats, series };
}

const strCache = (items: string[]): string =>
  el('c:strCache', {}, el('c:ptCount', { val: items.length }) + items.map((v, i) => el('c:pt', { idx: i }, el('c:v', {}, esc(v)))).join(''));
const numCache = (items: number[]): string =>
  el('c:numCache', {}, el('c:formatCode', {}, 'General') + el('c:ptCount', { val: items.length }) + items.map((v, i) => el('c:pt', { idx: i }, el('c:v', {}, String(v)))).join(''));

function seriesEl(kind: ChartElement['chart'], s: { name: string; values: number[]; color: ReturnType<typeof asColor> }, i: number, cats: string[]): string {
  const n = cats.length;
  const c = col(i + 1);
  const tx = el('c:tx', {}, el('c:strRef', {}, el('c:f', {}, `Sheet1!$${c}$1`) + strCache([s.name])));
  const catRef = el('c:strRef', {}, el('c:f', {}, `Sheet1!$A$2:$A$${n + 1}`) + strCache(cats));
  const valRef = el('c:numRef', {}, el('c:f', {}, `Sheet1!$${c}$2:$${c}$${n + 1}`) + numCache(s.values));
  const head = el('c:idx', { val: i }) + el('c:order', { val: i }) + tx;
  const fill = s.color ? solidFill(s.color) : '';
  switch (kind) {
    case 'bar':
    case 'column':
      return el('c:ser', {}, head + (fill ? el('c:spPr', {}, fill) : '') + el('c:invertIfNegative', { val: 0 }) + el('c:cat', {}, catRef) + el('c:val', {}, valRef));
    case 'line':
      return el(
        'c:ser',
        {},
        head +
          (s.color ? el('c:spPr', {}, el('a:ln', { w: 28575, cap: 'rnd' }, solidFill(s.color) + '<a:round/>')) : el('c:spPr', {}, el('a:ln', { w: 28575, cap: 'rnd' }, '<a:round/>'))) +
          el('c:marker', {}, el('c:symbol', { val: 'circle' }) + el('c:size', { val: 5 })) +
          el('c:cat', {}, catRef) +
          el('c:val', {}, valRef) +
          el('c:smooth', { val: 0 })
      );
    case 'pie':
      return el('c:ser', {}, head + el('c:cat', {}, catRef) + el('c:val', {}, valRef));
    case 'scatter': {
      const xs = cats.map((v, k) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : k + 1));
      const xRef = el('c:numRef', {}, el('c:f', {}, `Sheet1!$A$2:$A$${n + 1}`) + numCache(xs));
      return el(
        'c:ser',
        {},
        head +
          el('c:spPr', {}, el('a:ln', { w: 19050 }, '<a:noFill/>')) +
          el('c:marker', {}, el('c:symbol', { val: 'circle' }) + el('c:size', { val: 7 }) + (s.color ? el('c:spPr', {}, solidFill(s.color)) : '')) +
          el('c:xVal', {}, xRef) +
          el('c:yVal', {}, valRef) +
          el('c:smooth', { val: 0 })
      );
    }
  }
}

const AX_CAT = '111111111';
const AX_VAL = '222222222';

function axes(kind: ChartElement['chart']): string {
  if (kind === 'pie') return '';
  const horizontal = kind === 'bar';
  const numFmt = el('c:numFmt', { formatCode: 'General', sourceLinked: 1 });
  const none = el('c:majorTickMark', { val: 'none' }) + el('c:minorTickMark', { val: 'none' }) + el('c:tickLblPos', { val: 'nextTo' });
  if (kind === 'scatter') {
    return (
      el('c:valAx', {}, el('c:axId', { val: AX_CAT }) + el('c:scaling', {}, el('c:orientation', { val: 'minMax' })) + el('c:delete', { val: 0 }) + el('c:axPos', { val: 'b' }) + numFmt + none + el('c:crossAx', { val: AX_VAL }) + el('c:crosses', { val: 'autoZero' }) + el('c:crossBetween', { val: 'midCat' })) +
      el('c:valAx', {}, el('c:axId', { val: AX_VAL }) + el('c:scaling', {}, el('c:orientation', { val: 'minMax' })) + el('c:delete', { val: 0 }) + el('c:axPos', { val: 'l' }) + el('c:majorGridlines') + numFmt + none + el('c:crossAx', { val: AX_CAT }) + el('c:crosses', { val: 'autoZero' }) + el('c:crossBetween', { val: 'midCat' }))
    );
  }
  return (
    el('c:catAx', {}, el('c:axId', { val: AX_CAT }) + el('c:scaling', {}, el('c:orientation', { val: 'minMax' })) + el('c:delete', { val: 0 }) + el('c:axPos', { val: horizontal ? 'l' : 'b' }) + numFmt + none + el('c:crossAx', { val: AX_VAL }) + el('c:crosses', { val: 'autoZero' }) + el('c:auto', { val: 1 }) + el('c:lblAlgn', { val: 'ctr' }) + el('c:lblOffset', { val: 100 }) + el('c:noMultiLvlLbl', { val: 0 })) +
    el('c:valAx', {}, el('c:axId', { val: AX_VAL }) + el('c:scaling', {}, el('c:orientation', { val: 'minMax' })) + el('c:delete', { val: 0 }) + el('c:axPos', { val: horizontal ? 'b' : 'l' }) + el('c:majorGridlines') + numFmt + none + el('c:crossAx', { val: AX_CAT }) + el('c:crosses', { val: 'autoZero' }) + el('c:crossBetween', { val: 'between' }))
  );
}

/** The chart part, or null for a chart with nothing in it. `externalId` is the workbook's relationship id. */
export function chartPartXml(c: Data, externalId: string): string | null {
  const d = norm(c);
  if (!d) return null;
  const sers = d.series.map((s, i) => seriesEl(c.chart, s, i, d.cats)).join('');
  const ax = el('c:axId', { val: AX_CAT }) + el('c:axId', { val: AX_VAL });
  let group: string;
  switch (c.chart) {
    case 'bar':
    case 'column':
      group = el('c:barChart', {}, el('c:barDir', { val: c.chart === 'bar' ? 'bar' : 'col' }) + el('c:grouping', { val: 'clustered' }) + el('c:varyColors', { val: 0 }) + sers + el('c:gapWidth', { val: 150 }) + ax);
      break;
    case 'line':
      group = el('c:lineChart', {}, el('c:grouping', { val: 'standard' }) + el('c:varyColors', { val: 0 }) + sers + el('c:marker', { val: 1 }) + ax);
      break;
    case 'pie':
      group = el('c:pieChart', {}, el('c:varyColors', { val: 1 }) + sers + el('c:firstSliceAng', { val: 0 }));
      break;
    case 'scatter':
      group = el('c:scatterChart', {}, el('c:scatterStyle', { val: 'lineMarker' }) + el('c:varyColors', { val: 0 }) + sers + ax);
      break;
  }
  const title = typeof c.title === 'string' && c.title.trim() !== '' ? c.title.trim() : '';
  const titleEl = title
    ? el('c:title', {}, el('c:tx', {}, el('c:rich', {}, '<a:bodyPr/><a:lstStyle/>' + el('a:p', {}, el('a:pPr', {}, '<a:defRPr sz="1800" b="0"/>') + el('a:r', {}, '<a:rPr lang="en-US" sz="1800" b="0"/>' + el('a:t', {}, esc(title)))))) + el('c:overlay', { val: 0 }))
    : '';
  const legend = d.series.length > 1 || c.chart === 'pie' ? el('c:legend', {}, el('c:legendPos', { val: 'b' }) + el('c:overlay', { val: 0 })) : '';
  return (
    XML_DECL +
    el(
      'c:chartSpace',
      { 'xmlns:c': NS_C, 'xmlns:a': NS_A, 'xmlns:r': NS_R },
      el('c:date1904', { val: 0 }) +
        el('c:roundedCorners', { val: 0 }) +
        el('c:chart', {}, titleEl + el('c:autoTitleDeleted', { val: title ? 0 : 1 }) + el('c:plotArea', {}, '<c:layout/>' + group + axes(c.chart)) + legend + el('c:plotVisOnly', { val: 1 }) + el('c:dispBlanksAs', { val: 'gap' })) +
        el('c:externalData', { 'r:id': externalId }, el('c:autoUpdate', { val: 0 }))
    )
  );
}

const cell = (ref: string, v: string | number): string =>
  typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;

/** The workbook behind a chart: the same values the part caches. */
export function chartWorkbook(c: Data): Uint8Array | null {
  const d = norm(c);
  if (!d) return null;
  const rows: string[] = [];
  rows.push(`<row r="1">${d.series.map((s, i) => cell(`${col(i + 1)}1`, s.name)).join('')}</row>`);
  d.cats.forEach((name, r) => {
    const x = c.chart === 'scatter' && Number.isFinite(Number(name)) && name.trim() !== '' ? Number(name) : name;
    rows.push(`<row r="${r + 2}">${cell(`A${r + 2}`, x)}${d.series.map((s, i) => cell(`${col(i + 1)}${r + 2}`, s.values[r] ?? 0)).join('')}</row>`);
  });
  const sheet = `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`;
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/workbook.xml': strToU8(`${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`
      ),
      'xl/styles.xml': strToU8(
        `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
      ),
      'xl/worksheets/sheet1.xml': strToU8(sheet)
    },
    { mtime: new Date(Date.UTC(2026, 0, 1)) }
  );
}

