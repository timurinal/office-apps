/**
 * Makes the pptx corpus: `tests/corpus/pptx/*.pptx`, each with a `<name>.expect.json` saying what is
 * true of it, and `pptx/hostile/*.pptx` that must be refused or neutralised.
 *
 *     node tests/corpus/generate/make_pptx.mjs
 *
 * The decks are hand-written OOXML in the three dialects (PowerPoint, Google Slides, LibreOffice);
 * see pptx_lib.mjs. The files are committed so the tests depend on neither this script nor any
 * library. Nothing is downloaded.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { Deck, NS, OFFICE_COLORS, XML, clr, esc, ln, relsXml, solid, t, zip } from './pptx_lib.mjs';
import { EMF, GIF_PINK, JPEG_GREEN, PNG_BLUE, PNG_TALL, SVG, WEBP_GREY } from './pptx_images.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'pptx');
const IN = 914400;
// Only what this script makes is cleared: the tests live in the same folder.
mkdirSync(join(OUT, 'hostile'), { recursive: true });
// The decks python-pptx made (make_python_pptx.py) are not this script's to clear.
for (const dir of [OUT, join(OUT, 'hostile')]) for (const f of readdirSync(dir)) if ((/\.(?:pptx|expect\.json)$/.test(f) && !f.includes('python-pptx')) || f === 'index.json') rmSync(join(dir, f));

const decks = [];
function save(name, deck, extra = {}) {
  const bytes = deck.build();
  writeFileSync(join(OUT, `${name}.pptx`), bytes);
  writeFileSync(join(OUT, `${name}.expect.json`), JSON.stringify({ ...deck.expectation(), ...extra }, null, 1));
  decks.push(name);
  console.log('wrote', name, bytes.length);
}

// ── 01 PowerPoint: text, formatting, a styled shape, a line ───────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Quarterly review' });
  d.slide('Title Slide', (s) => {
    s.title('Quarterly review');
    s.subtitle('Finance and operations');
  });
  d.slide('Title and Content', (s) => {
    s.title('Agenda');
    s.body(['Results', 'Outlook', { t: 'Risks and mitigations', lvl: 1 }]);
    s.textBox(IN, 5 * IN, 5 * IN, IN, [
      { runs: [{ t: 'Bold ', b: true }, { t: 'italic ', i: true }, { t: 'underlined ', u: true }, { t: 'struck ', strike: true }, { t: 'sized and red', sz: 20, color: 'C00000' }] },
      { t: 'Second paragraph, centred', algn: 'ctr', bullet: 'none' }
    ]);
  });
  d.slide('Title Only', (s) => {
    s.title('Shapes');
    s.shape('roundRect', 2 * IN, 2 * IN, 3 * IN, IN, { style: true, paras: { t: 'On a style', algn: 'ctr' }, adj: 30000, body: { anchor: 'ctr' } });
    s.line(7 * IN, 2 * IN, 10 * IN, 4 * IN, { color: '2F5597', w: 28575, tail: 'triangle', head: 'oval' });
  });
  save('01-powerpoint-basic', d);
}

// ── 02 PowerPoint: every layout, geometry inherited ──────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Layouts' });
  d.slide('Title Slide', (s) => {
    s.title('A title slide');
    s.subtitle('With a subtitle');
  });
  d.slide('Section Header', (s) => {
    s.title('Part one');
    s.body('What comes first');
  });
  d.slide('Two Content', (s) => {
    s.title('Two columns');
    s.ph('half1', ['Left one', 'Left two']);
    s.ph('half2', ['Right one', 'Right two']);
  });
  d.slide('Title Only', (s) => s.title('Only a title'));
  d.slide('Blank');
  d.slide('Title and Content', (s) => {
    s.title('With a footer and a number');
    s.body('Content');
    s.ph('ftr', 'Confidential');
    s.ph('sldNum', { runs: [{ fld: 'slidenum', t: '6' }] });
  });
  save('02-powerpoint-layouts', d);
}

// ── 03 theme colours: tints, alpha, a dark colour map ────────────────────────────────────────
{
  const dark = '<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  const d = new Deck('powerpoint', { title: 'Colours', clrMap: dark });
  d.slide('Title and Content', (s) => {
    s.title('Theme colours', {});
    s.shape('rect', IN, 2 * IN, 2 * IN, IN, { fill: { scheme: 'accent1' }, paras: 'accent1' });
    s.shape('rect', 3.2 * IN, 2 * IN, 2 * IN, IN, { fill: { scheme: 'accent1', lumMod: 60000, lumOff: 40000 }, paras: 'lighter 40%' });
    s.shape('rect', 5.4 * IN, 2 * IN, 2 * IN, IN, { fill: { scheme: 'accent2', lumMod: 75000 }, paras: 'darker 25%' });
    s.shape('rect', 7.6 * IN, 2 * IN, 2 * IN, IN, { fill: { scheme: 'accent3', alpha: 50000 }, paras: 'half clear' });
    s.shape('rect', IN, 3.4 * IN, 2 * IN, IN, { fill: { rgb: '112233', alpha: 40000 }, paras: 'hex, 40%' });
    s.shape('rect', 3.2 * IN, 3.4 * IN, 2 * IN, IN, { fill: { rgb: '4472C4', lumMod: 50000 }, paras: 'hex darker' });
    s.shape('rect', 5.4 * IN, 3.4 * IN, 2 * IN, IN, { fill: { scheme: 'bg1' }, paras: { t: 'bg1 on dark', color: { scheme: 'tx1' } } });
    s.shape('rect', 7.6 * IN, 3.4 * IN, 2 * IN, IN, { fill: { sys: 'windowText', last: '000000' }, paras: { t: 'system', color: { prst: 'white' } } });
    s.shape('rect', IN, 4.8 * IN, 2 * IN, IN, { fill: { scheme: 'accent4', tint: 40000 }, paras: 'tint' });
  });
  save('03-theme-colours', d);
}

// ── 04 Google Slides: explicit paragraph and run properties ───────────────────────────────────
{
  const d = new Deck('google', { title: 'From Google Slides' });
  d.slide('Title slide', (s) => {
    s.title({ t: 'Launch plan', sz: 36, font: 'Arial' });
    s.subtitle({ t: 'Team offsite', sz: 18 });
  });
  d.slide('Title and body', (s) => {
    s.title({ t: 'What we will do', sz: 28 });
    s.body([{ t: 'Plan the week', sz: 18 }, { t: 'Ship the thing', sz: 18 }, { t: 'A sub point', sz: 16, lvl: 1 }]);
    s.textBox(311700, 4200000, 4000000, 400000, { t: 'Footnote in Arial', sz: 10, font: 'Arial', color: '666666' }, { fit: 'shrink' });
  });
  d.slide('Blank', (s) => {
    s.shape('ellipse', 3000000, 1500000, 2000000, 2000000, { fill: 'FFAB40', ln: ln(9525, '212121'), paras: { t: 'Round', algn: 'ctr', sz: 18 }, body: { anchor: 'ctr' } });
  });
  save('04-google-basic', d);
}

// ── 05 Google Slides: a table with borders, pictures, columns ────────────────────────────────
{
  const d = new Deck('google', { title: 'Google table' });
  const png = d.addMedia(PNG_BLUE, 'png');
  const jpg = d.addMedia(JPEG_GREEN, 'jpeg');
  d.slide('Title and two columns', (s) => {
    s.title({ t: 'Compare', sz: 28 });
    s.ph('half1', [{ t: 'Before', sz: 18 }]);
    s.ph('half2', [{ t: 'After', sz: 18 }]);
  });
  d.slide('Title only', (s) => {
    s.title({ t: 'Numbers', sz: 28 });
    s.table(311700, 1500000, [2000000, 2000000, 2000000], [
      [{ t: 'Region', fill: 'F3F3F3', b: true, border: 'CCCCCC' }, { t: 'Q1', fill: 'F3F3F3', b: true, border: 'CCCCCC' }, { t: 'Q2', fill: 'F3F3F3', b: true, border: 'CCCCCC' }],
      [{ t: 'North', border: 'CCCCCC' }, { t: '120', border: 'CCCCCC' }, { t: '140', border: 'CCCCCC' }],
      [{ t: 'South', border: 'CCCCCC' }, { t: '90', border: 'CCCCCC' }, { t: '95', border: 'CCCCCC' }]
    ]);
    s.pic(png, 7000000, 3500000, 1600000, 900000, { alt: 'A blue picture' });
    s.pic(jpg, 7000000, 2300000, 1600000, 900000);
  });
  save('05-google-table-pictures', d);
}

// ── 06 LibreOffice 16:9 ──────────────────────────────────────────────────────────────────────
{
  const d = new Deck('libreoffice', { title: 'From LibreOffice' });
  d.slide('Title Slide', (s) => {
    s.title({ t: 'Impress deck', sz: 44 });
    s.subtitle({ t: 'Written by LibreOffice', sz: 32, algn: 'ctr' });
  });
  d.slide('Title, Content', (s) => {
    s.title({ t: 'Points', sz: 44 });
    s.body([{ t: 'First', sz: 32 }, { t: 'Second', sz: 32 }, { t: 'Nested', sz: 28, lvl: 1 }]);
    s.setNotes([{ t: 'Say this first.', sz: 12 }, { t: 'Then this.', sz: 12 }]);
  });
  d.slide('Blank Slide', (s) => {
    s.textBox(2000000, 2000000, 6000000, 1200000, { t: 'A text box with no autofit', sz: 24 }, { fit: 'none' });
    s.shape('rect', 2000000, 3800000, 3000000, 1000000, { fill: '729FCF', ln: ln(0, null), paras: { t: 'Box', sz: 18, algn: 'ctr' }, body: { anchor: 'ctr' } });
  });
  save('06-libreoffice-basic', d);
}

// ── 07 LibreOffice 4:3 ───────────────────────────────────────────────────────────────────────
{
  const d = new Deck('libreoffice', { title: 'Four by three', size: [9144000, 6858000] });
  d.slide('Title Slide', (s) => {
    s.title({ t: 'Old shape', sz: 44 });
    s.subtitle({ t: '4:3', sz: 32 });
  });
  d.slide('Title and 2 Content', (s) => {
    s.title({ t: 'Two', sz: 44 });
    s.ph('half1', [{ t: 'Left', sz: 28 }]);
    s.ph('half2', [{ t: 'Right', sz: 28 }]);
  });
  save('07-libreoffice-4x3', d);
}

// ── 08 16:10 and 09 4:3 PowerPoint ───────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Sixteen by ten', size: [9144000, 5715000] });
  d.slide('Title Slide', (s) => {
    s.title('Sixteen by ten');
    s.subtitle('Between the two');
  });
  d.slide('Title and Content', (s) => {
    s.title({ t: 'A 44 point title', sz: 44 });
    s.body([{ t: 'Body at 28 points', sz: 28 }]);
    s.shape('rect', IN, 4 * IN, 2 * IN, 0.8 * IN, { fill: '70AD47', paras: { t: 'Box', sz: 18 } });
  });
  save('08-aspect-16x10', d);
}
{
  const d = new Deck('powerpoint', { title: 'Four by three', size: [9144000, 6858000] });
  d.slide('Title Slide', (s) => {
    s.title('Four by three');
    s.subtitle('The old shape');
  });
  d.slide('Title and Content', (s) => {
    s.title({ t: 'Title at 44', sz: 44 });
    s.body([{ t: 'Bullet one at 28', sz: 28 }, { t: 'Bullet two at 28', sz: 28 }]);
    s.textBox(IN, 5.5 * IN, 4 * IN, 0.8 * IN, { t: 'Small print at 12', sz: 12 });
  });
  save('09-aspect-4x3-powerpoint', d);
}

// ── 10 groups, nested, scaled, flipped and rotated ───────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Groups' });
  d.slide('Title Only', (s) => {
    s.title('Groups');
    // A group whose children are drawn at twice the size they are stated at.
    const a = s.mkShape('rect', 0, 0, IN, IN, { fill: 'C00000', paras: 'a' });
    const b = s.mkShape('ellipse', IN, 0, IN, IN, { fill: '00B050', paras: 'b' });
    s.group({ x: IN, y: 2 * IN, w: 4 * IN, h: 2 * IN, chX: 0, chY: 0, chW: 2 * IN, chH: IN }, [a, b], {
      box: s.box(IN, 2 * IN, 4 * IN, 2 * IN)
    });
    // Nested: an inner group inside an outer one, the outer shifted.
    const inner = s.mkGroup({ x: 0, y: 0, w: IN, h: IN, chX: 0, chY: 0, chW: IN, chH: IN }, [s.mkShape('rect', 0, 0, IN / 2, IN / 2, { fill: '0070C0', paras: 'deep' })]);
    s.group({ x: 6 * IN, y: 2 * IN, w: 2 * IN, h: 2 * IN, chX: 0, chY: 0, chW: IN, chH: IN }, [inner, s.mkShape('rect', IN / 2, IN / 2, IN / 2, IN / 2, { fill: 'FFC000', paras: 'outer' })]);
    // A group flipped across and rotated a quarter turn.
    s.group({ x: 9 * IN, y: 4 * IN, w: 2 * IN, h: IN, chX: 0, chY: 0, chW: 2 * IN, chH: IN, flipH: true }, [s.mkShape('rect', 0, 0, IN, IN, { fill: '7030A0', paras: 'flipped' })]);
  });
  save('10-groups-nested', d, {
    // Hand-worked: the first group maps child space 2in x 1in to 4in x 2in, so 2x. Child a (0,0,1in,1in) is at (1in,2in) and 2in wide.
    groupChildren: [
      { slide: 0, element: 0, children: [[IN, 2 * IN, 2 * IN, 2 * IN], [3 * IN, 2 * IN, 2 * IN, 2 * IN]] }
    ]
  });
}

// ── 11 tables: merges, fills, anchors ────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Tables' });
  d.slide('Title Only', (s) => {
    s.title('Merged cells');
    s.table(IN, 1.8 * IN, [1.5 * IN, 1.5 * IN, 1.5 * IN, 1.5 * IN], [
      [{ t: 'Header spans two', gridSpan: 2, fill: '4472C4', color: 'FFFFFF', b: true }, { t: '', hMerge: true }, { t: 'C', fill: '4472C4' }, { t: 'D', fill: '4472C4' }],
      [{ t: 'Tall', rowSpan: 2, anchor: 'ctr' }, 'b1', 'c1', 'd1'],
      [{ t: '', vMerge: true }, 'b2', { t: 'Big', gridSpan: 2, rowSpan: 2, fill: 'FFE699' }, { t: '', hMerge: true }],
      ['a4', 'b4', { t: '', vMerge: true }, { t: '', vMerge: true, hMerge: true }]
    ]);
  });
  d.slide('Title Only', (s) => {
    s.title('Plain');
    s.table(IN, 1.8 * IN, [2 * IN, 2 * IN], [['one', 'two'], ['three', 'four']], { firstRow: false, bandRow: false, style: false });
  });
  save('11-tables-merges', d, {
    tables: [{ slide: 0, rows: 4, cols: 4, spans: [{ r: 0, c: 0, colSpan: 2 }, { r: 1, c: 0, rowSpan: 2 }, { r: 2, c: 2, colSpan: 2, rowSpan: 2 }] }]
  });
}

// ── 12 charts ────────────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Charts' });
  const cats = ['Q1', 'Q2', 'Q3', 'Q4'];
  const series = [{ name: 'North', vals: [10, 12, 9, 15], color: '4472C4' }, { name: 'South', vals: [7, 8, 11, 6], color: 'ED7D31' }];
  d.slide('Title Only', (s) => {
    s.title('Column and bar');
    s.chart(IN, 1.8 * IN, 5 * IN, 4 * IN, { type: 'col', cats, series, title: 'By quarter' });
    s.chart(6.5 * IN, 1.8 * IN, 5 * IN, 4 * IN, { type: 'bar', cats, series });
  });
  d.slide('Title Only', (s) => {
    s.title('Line and pie');
    s.chart(IN, 1.8 * IN, 5 * IN, 4 * IN, { type: 'line', cats, series });
    s.chart(6.5 * IN, 1.8 * IN, 5 * IN, 4 * IN, { type: 'pie', cats: ['A', 'B', 'C'], series: [{ name: 'Share', vals: [50, 30, 20] }], title: 'Share' });
  });
  d.slide('Title Only', (s) => {
    s.title('Scatter, area, doughnut');
    s.chart(IN / 2, 1.8 * IN, 3.6 * IN, 3.5 * IN, { type: 'scatter', cats: [1, 2, 3, 4], series: [{ name: 'y', vals: [2, 4, 3, 8] }] });
    s.chart(4.3 * IN, 1.8 * IN, 3.6 * IN, 3.5 * IN, { type: 'area', cats, series: [series[0]] });
    s.chart(8.1 * IN, 1.8 * IN, 3.6 * IN, 3.5 * IN, { type: 'doughnut', cats: ['X', 'Y'], series: [{ name: 'Split', vals: [3, 1] }] });
  });
  save('12-charts', d, { warnings: ['area chart is drawn as a line chart', 'doughnut chart is drawn as a pie chart'] });
}

// ── 13 notes, 14 hidden slides ───────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Notes' });
  d.slide('Title and Content', (s) => {
    s.title('Has notes');
    s.body('A point');
    s.setNotes(['Open with the numbers.', 'Pause for questions.']);
  });
  d.slide('Title and Content', (s) => {
    s.title('No notes');
    s.body('Another point');
  });
  d.slide('Title Only', (s) => {
    s.title('Notes with formatting');
    s.setNotes([{ runs: [{ t: 'Bold', b: true }, { t: ' and plain' }] }, { t: 'Second' }]);
  });
  save('13-notes', d);
}
{
  const d = new Deck('powerpoint', { title: 'Hidden' });
  d.slide('Title Only', (s) => s.title('Shown'));
  d.slide('Title Only', (s) => {
    s.title('Hidden one');
    s.hidden();
  });
  d.slide('Title Only', (s) => s.title('Shown again'));
  d.slide('Title Only', (s) => {
    s.title('Hidden two');
    s.hidden();
  });
  save('14-hidden-slides', d);
}

// ── 15 transitions ───────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Transitions' });
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
  const alt = (inner, spd, dur) => `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14"><p:transition spd="${spd}" p14:dur="${dur}">${inner}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
  const cases = [
    ['<p:transition spd="med"><p:fade/></p:transition>', 'fade'],
    ['<p:transition spd="fast"><p:push dir="u"/></p:transition>', 'push'],
    ['<p:transition spd="slow"><p:wipe dir="r"/></p:transition>', 'wipe'],
    ['<p:transition><p:zoom dir="in"/></p:transition>', 'zoom'],
    [alt('<p14:vortex dir="r"/>', 'slow', 2000), 'fade'],
    [alt('<p14:pan dir="l"/>', 'med', 900), 'push'],
    ['<p:transition spd="fast"><p:cut/></p:transition>', 'none'],
    ['<p:transition spd="med"><p:dissolve/></p:transition>', 'fade'],
    ['<p:transition spd="med"><p:cover dir="d"/></p:transition>', 'push'],
    ['<p:transition spd="med"><p:blinds dir="horz"/></p:transition>', 'wipe']
  ];
  cases.forEach(([xml, kind], i) => d.slide('Title Only', (s) => {
    s.title(`Transition ${i + 1}`);
    s.transition(xml, kind);
  }));
  d.slide('Title Only', (s) => s.title('None'));
  save('15-transitions', d, { transitionDetails: [{ from: 'bottom' }, null, { from: 'left' }] });
}

// ── 16 pictures: formats, crop, fallbacks, ones that must go ─────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Pictures' });
  const png = d.addMedia(PNG_BLUE, 'png');
  const jpg = d.addMedia(JPEG_GREEN, 'jpeg');
  const gif = d.addMedia(GIF_PINK, 'gif');
  const webp = d.addMedia(WEBP_GREY, 'webp');
  const tall = d.addMedia(PNG_TALL, 'png');
  const emf = d.addMedia(EMF, 'emf');
  const svg = d.addMedia(SVG, 'svg');
  d.slide('Title Only', (s) => {
    s.title('Formats');
    s.pic(png, IN, 2 * IN, 2 * IN, 1.125 * IN, { alt: 'Blue' });
    s.pic(jpg, 3.5 * IN, 2 * IN, 2 * IN, 1.125 * IN);
    s.pic(gif, 6 * IN, 2 * IN, 1.2 * IN, 1.2 * IN);
    s.pic(webp, 8 * IN, 2 * IN, 2 * IN, 1.125 * IN);
  });
  d.slide('Title Only', (s) => {
    s.title('Crop');
    s.pic(png, IN, 2 * IN, 2 * IN, 1.125 * IN, { crop: { l: 25000, t: 10000, r: 25000, b: 0 }, name: 'Cropped' });
    s.pic(tall, 4 * IN, 2 * IN, IN, 2 * IN, { crop: { l: 0, t: 50000 } });
  });
  d.slide('Title Only', (s) => {
    s.title('Fallbacks');
    // An SVG with its PNG fallback: the PNG is the picture.
    s.pic(png, IN, 2 * IN, 2 * IN, 1.125 * IN, { svg, name: 'Vector with fallback' });
    // An EMF alone cannot be shown.
    s.pic(emf, 4 * IN, 2 * IN, 2 * IN, 1.125 * IN, { dropped: true });
    // A linked picture is never fetched.
    s.pic(png, 7 * IN, 2 * IN, 2 * IN, 1.125 * IN, { link: 'file:///C:/pictures/x.png', dropped: true });
  });
  save('16-images-crop', d, { warnings: ['in a format that cannot be shown', 'linked from outside the file'] });
}

// ── 17 hyperlinks ────────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Links' });
  d.slide('Title and Content', (s) => {
    s.title('Links');
    s.body([
      { runs: [{ t: 'The site', href: 'https://example.com/office' }, { t: ' and ' }, { t: 'mail us', href: 'mailto:hello@example.com' }] },
      { runs: [{ t: 'a script', href: 'javascript:alert(1)' }, { t: ' and ' }, { t: 'a file', href: 'file:///etc/passwd' }] },
      { runs: [{ t: 'other slide', jump: 'slide2.xml' }] }
    ]);
  });
  d.slide('Title Only', (s) => s.title('Second'));
  save('17-hyperlinks', d, { links: { kept: ['https://example.com/office', 'mailto:hello@example.com'], refused: 2 } });
}

// ── 18 bullets and numbering, nine levels ────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Bullets' });
  d.slide('Title and Content', (s) => {
    s.title('Levels');
    s.body(Array.from({ length: 9 }, (_, i) => ({ t: `Level ${i + 1}`, lvl: i })));
  });
  d.slide('Title and Content', (s) => {
    s.title('Numbered');
    s.body([
      { t: 'arabic period', bullet: { num: 'arabicPeriod' } },
      { t: 'arabic paren', bullet: { num: 'arabicParenR' } },
      { t: 'alpha lower', bullet: { num: 'alphaLcPeriod', start: 3 } },
      { t: 'alpha upper', bullet: { num: 'alphaUcPeriod' } },
      { t: 'roman lower', bullet: { num: 'romanLcPeriod' } },
      { t: 'roman upper', bullet: { num: 'romanUcPeriod' } },
      { t: 'a char', bullet: { char: '★', font: 'Arial' } },
      { t: 'wingdings square', bullet: { char: '§', font: 'Wingdings' } },
      { t: 'no bullet', bullet: 'none' }
    ]);
  });
  save('18-bullets-numbering', d);
}

// ── 19 custom geometry and shapes the deck has no form for ───────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Geometry' });
  d.slide('Title Only', (s) => {
    s.title('Freeforms');
    s.shape('cust', IN, 2 * IN, 2 * IN, 2 * IN, { fill: 'ED7D31', paras: 'freeform' });
    s.shape('flowChartDecision', 4 * IN, 2 * IN, 2 * IN, 2 * IN, { fill: 'A5A5A5', paras: 'decision' });
    s.shape('sun', 7 * IN, 2 * IN, 2 * IN, 2 * IN, { fill: 'FFC000', paras: 'sun' });
    s.shape('mathPlus', 9.5 * IN, 2 * IN, 1.5 * IN, 1.5 * IN, { fill: '5B9BD5' });
  });
  save('19-custom-geometry', d, { warnings: ['freeform shape', 'in a form that cannot be drawn'] });
}

// ── 20 shapes and lines ──────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Shapes' });
  d.slide('Title Only', (s) => {
    s.title('Presets');
    const kinds = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'rightArrow', 'chevron', 'cloud', 'heart', 'can'];
    kinds.forEach((k, i) => s.shape(k, (0.5 + (i % 6) * 1.9) * IN, (1.9 + Math.floor(i / 6) * 1.7) * IN, 1.5 * IN, 1.3 * IN, { fill: { scheme: `accent${(i % 6) + 1}` }, ln: ln(12700, '404040', t('a:prstDash', { val: 'dash' })) }));
  });
  d.slide('Title Only', (s) => {
    s.title('Lines');
    s.line(IN, 2 * IN, 5 * IN, 2 * IN, { color: 'C00000', w: 12700 });
    s.line(IN, 3 * IN, 5 * IN, 5 * IN, { color: '00B050', w: 38100, tail: 'arrow' });
    s.line(9 * IN, 3 * IN, 6 * IN, 5 * IN, { color: '0070C0', w: 25400, head: 'triangle', dash: 'sysDot' });
    s.line(6 * IN, 2 * IN, 9 * IN, 2.5 * IN, { color: '7030A0', prst: 'bentConnector3' });
    s.shape('rect', 2 * IN, 5.3 * IN, 2 * IN, IN, { fill: 'D9D9D9', rot: 15, shadow: true, paras: { t: 'rotated', algn: 'ctr' } });
    s.shape('triangle', 6 * IN, 5.3 * IN, 2 * IN, IN, { fill: 'FFD966', flipV: true, flipH: true });
  });
  save('20-shapes-lines', d, { warnings: ['drawn as a straight line'] });
}

// ── 21 backgrounds ───────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Backgrounds', masterBg: t('p:bg', {}, t('p:bgPr', {}, solid('F2F2F2') + '<a:effectLst/>')) });
  const png = d.addMedia(PNG_BLUE, 'png');
  d.slide('Title Only', (s) => s.title('Master background'));
  d.slide('Title Only', (s) => {
    s.title('Solid');
    s.background(t('p:bg', {}, t('p:bgPr', {}, solid({ scheme: 'accent1', lumMod: 20000, lumOff: 80000 }) + '<a:effectLst/>')));
  });
  d.slide('Title Only', (s) => {
    s.title('Gradient');
    s.background(t('p:bg', {}, t('p:bgPr', {}, '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="1F3864"/></a:gs><a:gs pos="100000"><a:srgbClr val="8FAADC"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:effectLst/>')));
  });
  d.slide('Title Only', (s) => {
    s.title('Picture');
    const rid = s.rel('image', `../media/${png.slice('ppt/media/'.length)}`);
    s.background(t('p:bg', {}, t('p:bgPr', {}, `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/>`)));
  });
  d.slide('Title Only', (s) => {
    s.title('From the theme');
    s.background(t('p:bg', {}, t('p:bgRef', { idx: 1001 }, clr({ scheme: 'accent2' }))));
  });
  save('21-backgrounds', d, { backgrounds: [null, 'solid', 'gradient', 'image', 'solid'] });
}

// ── 22 a long deck ───────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'A hundred and twenty' });
  const png = d.addMedia(PNG_BLUE, 'png');
  for (let i = 1; i <= 120; i++) {
    d.slide(i === 1 ? 'Title Slide' : 'Title and Content', (s) => {
      if (i === 1) {
        s.title('A long deck');
        s.subtitle('Slide 1 of 120');
        return;
      }
      s.title(`Slide ${i}`);
      s.body([`Point ${i}.1`, `Point ${i}.2`, { t: `Point ${i}.3`, lvl: 1 }]);
      s.textBox(IN, 6 * IN, 4 * IN, 0.5 * IN, { t: `Footnote ${i}`, sz: 12 });
      s.shape('rect', 9 * IN, 5.5 * IN, 2 * IN, IN, { fill: { scheme: `accent${(i % 6) + 1}` }, paras: { t: `${i}`, algn: 'ctr', color: 'FFFFFF' } });
      if (i % 10 === 0) s.pic(png, 9 * IN, 2 * IN, 2 * IN, 1.125 * IN);
      if (i % 15 === 0) s.setNotes(`Notes for ${i}`);
    });
  }
  save('22-120-slides', d);
}

// ── 23 SmartArt and OLE objects ──────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Objects' });
  const png = d.addMedia(PNG_BLUE, 'png');
  const emf = d.addMedia(EMF, 'emf');
  const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
  const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
  const sp = (name, x, y, w, h, fill, text) => `<dsp:sp modelId="{${name}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="${fill}"/></a:solidFill></dsp:spPr><dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style><dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${text}</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></dsp:txXfrm></dsp:sp>`;
  d.parts['ppt/diagrams/drawing1.xml'] = {
    data: `${XML}<dsp:drawing xmlns:dgm="${DGM}" xmlns:dsp="${DSP}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${sp('0001', 0, 500000, 1800000, 1000000, 'accent1', 'Plan')}${sp('0002', 2100000, 500000, 1800000, 1000000, 'accent2', 'Build')}${sp('0003', 4200000, 500000, 1800000, 1000000, 'accent3', 'Ship')}</dsp:spTree></dsp:drawing>`,
    type: 'application/vnd.ms-office.drawingml.diagramDrawing+xml'
  };
  d.parts['ppt/diagrams/data1.xml'] = {
    data: `${XML}<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst/><dgm:cxnLst/><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${DSP}" relId="rId7" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`,
    type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml'
  };
  d.parts['ppt/diagrams/layout1.xml'] = { data: `${XML}<dgm:layoutDef xmlns:dgm="${DGM}" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/default"/>`, type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml' };
  d.parts['ppt/diagrams/quickStyle1.xml'] = { data: `${XML}<dgm:styleDef xmlns:dgm="${DGM}" uniqueId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1"/>`, type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml' };
  d.parts['ppt/diagrams/colors1.xml'] = { data: `${XML}<dgm:colorsDef xmlns:dgm="${DGM}" uniqueId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2"/>`, type: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml' };
  d.slide('Title Only', (s) => {
    s.title('SmartArt');
    s.rel('diagramData', '../diagrams/data1.xml');
    s.rel('diagramLayout', '../diagrams/layout1.xml');
    s.rel('diagramQuickStyle', '../diagrams/quickStyle1.xml');
    s.rel('diagramColors', '../diagrams/colors1.xml');
    s.rel('http://schemas.microsoft.com/office/2007/relationships/diagramDrawing', '../diagrams/drawing1.xml');
    // rId2..rId5 are the four parts above, rId6 the drawing; the data model names rId7, which does not exist, so the single drawing is found by type.
    s.add({
      xml: `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${s.id()}" name="Diagram 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${IN}" y="${2 * IN}"/><a:ext cx="6000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/></a:graphicData></a:graphic></p:graphicFrame>`,
      exp: { kind: 'group', box: s.box(IN, 2 * IN, 6000000, 2000000), text: 'Plan\nBuild\nShip', children: [{ kind: 'shape' }, { kind: 'shape' }, { kind: 'shape' }] }
    });
  });
  const ole = (s, rid, x, y, w, h) => ({
    xml: `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${s.id()}" name="Object"/><p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v"><p:oleObj spid="_x0000_s1026" name="Worksheet" imgW="3000000" imgH="1500000" progId="Excel.Sheet.12"><p:embed/></p:oleObj></mc:Choice><mc:Fallback><p:oleObj name="Worksheet" imgW="3000000" imgH="1500000" progId="Excel.Sheet.12"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></mc:Fallback></mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame>`,
    exp: { kind: 'image', box: s.box(x, y, w, h), text: null }
  });
  d.slide('Title Only', (s) => {
    s.title('OLE with a picture');
    const rid = s.rel('image', `../media/${png.slice('ppt/media/'.length)}`);
    s.add(ole(s, rid, IN, 2 * IN, 3 * IN, 1.5 * IN));
  });
  d.slide('Title Only', (s) => {
    s.title('OLE with only an EMF');
    const rid = s.rel('image', `../media/${emf.slice('ppt/media/'.length)}`);
    s.tree += ole(s, rid, IN, 2 * IN, 3 * IN, 1.5 * IN).xml;
  });
  save('23-smartart-ole', d, { warnings: ['in a format that cannot be shown'] });
}

// ── 24 two masters, two themes ───────────────────────────────────────────────────────────────
{
  const second = {
    theme: { name: 'Second', colors: { ...OFFICE_COLORS, accent1: 'C00000', accent2: '00B050', dk2: '203864' }, major: 'Georgia', minor: 'Verdana' },
    layouts: [{ name: 'Divider', type: 'secHead', ph: ['title', 'dt:10', 'ftr:11', 'sldNum:12'] }],
    bg: t('p:bg', {}, t('p:bgPr', {}, solid('203864') + '<a:effectLst/>')),
    tree: `<p:sp><p:nvSpPr><p:cNvPr id="90" name="Band"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="6000000"/><a:ext cx="12192000" cy="858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid({ scheme: 'accent1' })}</p:spPr></p:sp>`
  };
  const d = new Deck('powerpoint', { title: 'Two masters', extraMasters: [second] });
  d.slide('Title and Content', (s) => {
    s.title('First master');
    s.body('Its own theme');
  });
  const divider = d.slide('Title and Content', (s) => {
    s.masterIndex = 2;
  });
  divider.layout = 0;
  divider.tree = '';
  d.slides.pop();
  const s2 = d.slide('Title and Content');
  s2.masterIndex = 2;
  s2.layout = 0;
  s2.mkPh = function (key, paras, o) {
    return Object.getPrototypeOf(this).mkPh.call(this, key, paras, o);
  };
  // The divider layout belongs to the second master; its title placeholder inherits from it.
  s2.layout = 0;
  s2.add({
    xml: `<p:sp><p:nvSpPr><p:cNvPr id="${s2.id()}" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Second master</a:t></a:r></a:p></p:txBody></p:sp>`,
    exp: { kind: 'shape', ph: 'title', box: s2.box(...d.place('title')), text: 'Second master' }
  });
  save('24-multi-master', d, { layouts: ['Title Slide', 'Title and Content', 'Section Header', 'Two Content', 'Title Only', 'Blank', 'Divider'], slideLayouts: ['Title and Content', 'Divider'] });
}

// ── 25 text formats ──────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Text' });
  d.slide('Title Only', (s) => {
    s.title('Runs');
    s.textBox(IN, 2 * IN, 8 * IN, IN, [
      { runs: [{ t: 'x' }, { t: '2', sup: true }, { t: ' and H' }, { t: '2', sub: true }, { t: 'O' }] },
      { runs: [{ t: 'Theme major ', font: '+mj-lt' }, { t: 'theme minor ', font: '+mn-lt' }, { t: 'Georgia', font: 'Georgia' }] },
      { runs: [{ t: 'highlighted', hl: 'FFFF00' }, { t: ' and a line' }, { br: true }, { t: 'after a break' }] }
    ]);
    s.textBox(IN, 4 * IN, 3 * IN, IN, 'Vertical', { body: { vert: 'vert' }, fit: 'grow' });
    s.textBox(5 * IN, 4 * IN, 3 * IN, IN, 'Anchored bottom, tight insets', { body: { anchor: 'b', insets: [0, 0, 0, 0] }, fit: 'shrink', wrap: false });
    s.textBox(9 * IN, 4 * IN, 2 * IN, IN, [{ runs: [{ t: 'Page ' }, { fld: 'slidenum', t: '4' }] }]);
  });
  d.slide('Title Only', (s) => {
    s.title('Spacing');
    s.textBox(IN, 2 * IN, 8 * IN, 3 * IN, [
      { t: 'Line spacing 90%', lnSpc: 90000 },
      { t: 'Space before 12pt', spcBef: 1200 },
      { t: 'Space after 6pt', spcAft: 600 },
      { t: 'Indented', marL: 457200, indent: -228600, bullet: { char: '•', font: 'Arial' } }
    ]);
  });
  save('25-text-formats', d);
}

// ── 26 placeholder inheritance: geometry, text box and style from layout and master ─────────
{
  const layouts = [
    { name: 'Wide Title', type: 'titleOnly', ph: ['title', 'body:1'], tree: '' },
    { name: 'Plain', type: 'blank', ph: [] }
  ];
  const d = new Deck('powerpoint', { title: 'Inheritance', layouts });
  d.slide('Wide Title', (s) => {
    // Neither states a place; the master's are inherited.
    s.title('Inherits from the master');
    s.body(['Master body style', { t: 'second level', lvl: 1 }]);
  });
  d.slide('Wide Title', (s) => {
    // The title states its own place.
    s.title('States its own place', { box: [1000000, 500000, 6000000, 900000] });
    s.body('Still inherits');
  });
  save('26-placeholder-inheritance', d);
}

// ── 27 Unicode ───────────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Unicode' });
  d.slide('Title and Content', (s) => {
    s.title('Many scripts');
    s.body(['Café, naïve, Zürich', 'Привет, мир', 'Ελληνικά', '日本語のテキスト', '한국어', 'مرحبا بالعالم', 'שלום עולם', 'Emoji 😀 🚀 and a flag 🇳🇴', 'Maths: ∑ ∫ ≈ ≠ √']);
  });
  save('27-unicode', d);
}

// ── 28 strict namespaces ─────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Strict', strict: true });
  d.slide('Title and Content', (s) => {
    s.title('Strict OOXML');
    s.body('Read through the other namespaces');
  });
  save('28-strict-namespaces', d);
}

// ── 29 edges ─────────────────────────────────────────────────────────────────────────────────
{
  const d = new Deck('powerpoint', { title: 'Edges' });
  d.slide('Blank');
  d.slide('Title and Content', (s) => {
    s.ph('title', []);
    s.ph('body', []);
  });
  d.slide('Title Only', (s) => {
    s.title('Zero and hidden');
    s.shape('rect', IN, 2 * IN, 0, 0, { fill: 'FF0000' });
    s.shape('rect', 2 * IN, 2 * IN, IN, IN, { fill: '00FF00', hidden: true, paras: 'never seen' });
    s.shape('rect', 3 * IN, 2 * IN, IN, IN, { fill: 'AAAAAA', paras: '' });
  });
  d.slide('Title Only', (s) => {
    s.title('Off the slide');
    s.shape('rect', -2 * IN, -IN, 3 * IN, 2 * IN, { fill: '0000FF', paras: 'partly outside' });
    s.shape('rect', 11 * IN, 6 * IN, 4 * IN, 3 * IN, { fill: '00FFFF', paras: 'also outside' });
  });
  save('29-edge-cases', d);
}

// ── 30 master decorations, hidden on one layout and one slide ────────────────────────────────
{
  const logo = `<p:sp><p:nvSpPr><p:cNvPr id="40" name="Logo"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="10800000" y="200000"/><a:ext cx="1000000" cy="400000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid({ scheme: 'accent1' })}</p:spPr></p:sp>`;
  const layouts = [
    { name: 'With logo', type: 'obj', ph: ['title', 'body:1'] },
    { name: 'No logo', type: 'obj', ph: ['title', 'body:1'], showMasterSp: false, tree: `<p:sp><p:nvSpPr><p:cNvPr id="41" name="Layout bar"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="6600000"/><a:ext cx="12192000" cy="258000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('404040')}</p:spPr></p:sp>` }
  ];
  const d = new Deck('powerpoint', { title: 'Decorations', masterTree: logo, layouts });
  d.slide('With logo', (s) => {
    s.title('Logo shows');
    s.body('On the master');
  });
  d.slide('No logo', (s) => {
    s.title('Layout hides it');
    s.body('The layout draws its own bar');
  });
  d.slide('With logo', (s) => {
    s.title('Slide hides it');
    s.body('Slide-level');
    s.attrs.showMasterSp = '0';
    s.hideMaster = true;
  });
  save('30-master-decorations', d, { showMaster: { layouts: { 'No logo': false }, slides: [null, null, false] }, masterElements: 1 });
}

// ── hostile files ────────────────────────────────────────────────────────────────────────────
const MIN_CT = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/></Types>';
const hostile = (name, bytes) => {
  writeFileSync(join(OUT, 'hostile', `${name}.pptx`), bytes);
  console.log('wrote hostile', name, bytes.length);
};

// A tiny valid deck to build hostile ones from: one master, one layout, n slides.
function tiny(slides, over = {}) {
  const files = {
    '[Content_Types].xml': MIN_CT,
    '_rels/.rels': relsXml([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]),
    'ppt/presentation.xml': over.presentation ?? `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relsXml([{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }, ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` }))]),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relsXml([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, ...(over.masterRels ?? [])]),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${NS}><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relsXml([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }])
  };
  slides.forEach((tree, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = typeof tree === 'string' && tree.startsWith('<?xml') ? tree : `${XML}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${tree}</p:spTree></p:cSld></p:sld>`;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = relsXml([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, ...((over.slideRels && over.slideRels[i]) ?? [])]);
  });
  for (const [k, v] of Object.entries(over.files ?? {})) files[k] = v;
  return files;
}

const textBox = (id, text, extra = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="T${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${extra}<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

// A zip bomb: a few kilobytes that declare more than the reader will inflate.
hostile('zip-bomb', zip({ ...tiny([textBox(2, 'x')]), 'ppt/media/huge.bin': new Uint8Array(72 * 1024 * 1024) }));
// Two thousand tiny entries over the entry limit are covered in security.test.ts, which builds them in memory.

// The billion laughs, in a slide.
hostile(
  'entity-expansion',
  zip(
    tiny([
      `${XML}<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">]><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${textBox(2, '&lol4;')}</p:spTree></p:cSld></p:sld>`
    ])
  )
);

// An external entity that names a file on the reader's disk, in presentation.xml.
hostile(
  'doctype-external',
  zip(
    tiny([textBox(2, 'x')], {
      presentation: `${XML}<!DOCTYPE p [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:extLst>&xxe;</p:extLst></p:presentation>`
    })
  )
);

// Relationships that point out of the file: an external picture, a climbing path, a linked OLE object, a master-level external part.
hostile(
  'external-rels',
  zip(
    tiny(
      [
        `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Remote"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
          `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Climbing"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="2914400" y="914400"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
          `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Embedded as external"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="4914400" y="914400"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
          textBox(5, 'Still here')
      ],
      {
        slideRels: [
          [
            { id: 'rId2', type: 'image', target: 'http://169.254.169.254/latest/meta-data/', external: true },
            { id: 'rId3', type: 'image', target: '../../../../../../etc/passwd' }
          ]
        ],
        masterRels: [{ id: 'rId9', type: 'oleObject', target: 'file:///etc/shadow', external: true }]
      }
    )
  )
);

// Links to places a person should never be sent.
hostile(
  'javascript-links',
  zip(
    tiny(
      [
        ['javascript:alert(1)', 'JaVaScRiPt:alert(2)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com/x', 'java&#9;script:alert(3)', 'https://example.com/ok', 'mailto:a@example.com']
          .map((href, i) => `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="L${i}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="${914400 + i * 400000}"/><a:ext cx="3000000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId${i + 2}"/></a:rPr><a:t>link ${i}</a:t></a:r></a:p></p:txBody></p:sp>`)
          .join('')
      ],
      {
        slideRels: [
          ['javascript:alert(1)', 'JaVaScRiPt:alert(2)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com/x', 'java&#9;script:alert(3)', 'https://example.com/ok', 'mailto:a@example.com'].map((target, i) => ({ id: `rId${i + 2}`, type: 'hyperlink', target, external: true }))
        ]
      }
    )
  )
);

// Dimensions that are not dimensions.
hostile(
  'huge-slide-size',
  zip(
    tiny([textBox(2, 'On an absurd slide')], {
      presentation: `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="2147483647" cy="2147483647"/></p:presentation>`
    })
  )
);
hostile(
  'huge-shapes',
  zip(
    tiny([
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Huge"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="99999999999"><a:off x="-9000000000000000" y="9000000000000000"/><a:ext cx="9000000000000000" cy="9007199254740993"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="999999999999"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr lIns="99999999999999"/><a:lstStyle/><a:p><a:r><a:rPr sz="999999999"/><a:t>big</a:t></a:r></a:p></p:txBody></p:sp>` +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="9000000000000"/><a:gridCol w="-5"/></a:tblGrid><a:tr h="9000000000000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc gridSpan="99999999"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
        textBox(4, 'After the huge ones')
    ])
  )
);

// A picture that lies about what it is.
hostile(
  'lying-picture',
  zip(
    tiny(
      [[1, 2, 3, 4, 5].map((n) => `<p:pic><p:nvPicPr><p:cNvPr id="${n + 1}" name="P${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${n + 1}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${n * 1000000}" y="914400"/><a:ext cx="900000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`).join('')],
      {
        slideRels: [[1, 2, 3, 4, 5].map((n) => ({ id: `rId${n + 1}`, type: 'image', target: `../media/image${n}.png` }))],
        files: {
          // A script in an SVG that says it is a PNG.
          'ppt/media/image1.png': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
          // A web page.
          'ppt/media/image2.png': strToU8('<!DOCTYPE html><html><script>alert(2)</script></html>'),
          // Executable bytes.
          'ppt/media/image3.png': Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]),
          // A real PNG that has the wrong name: it is a picture, whatever it is called.
          'ppt/media/image4.png': PNG_BLUE,
          // A JPEG named as a PNG.
          'ppt/media/image5.png': JPEG_GREEN
        }
      }
    )
  )
);

// More slides than a deck holds.
hostile('too-many-slides', zip(tiny(Array.from({ length: 501 }, (_, i) => textBox(2, `Slide ${i}`)))));
// More shapes on one slide than a slide holds.
hostile('too-many-shapes', zip(tiny([Array.from({ length: 600 }, (_, i) => textBox(i + 2, `Shape ${i}`)).join('')])));
// Groups nested past the limit.
hostile(
  'deep-groups',
  zip(
    tiny([
      Array.from({ length: 30 }).reduce(
        (inner) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`,
        textBox(2, 'Deep inside')
      )
    ])
  )
);
// XML nested far past anything a slide has.
hostile('deep-xml', zip(tiny([`${XML}<p:sld ${NS}><p:cSld><p:spTree>${'<a:x>'.repeat(400)}${'</a:x>'.repeat(400)}</p:spTree></p:cSld></p:sld>`])));
// Not a presentation: text, a truncated zip, a zip of something else.
hostile('not-a-presentation', strToU8('This is plainly not a presentation, though it has the name of one and is long enough.'));
{
  const good = zip(tiny([textBox(2, 'x')]));
  hostile('truncated', good.slice(0, Math.floor(good.length / 2)));
}
hostile('zip-of-something-else', zip({ 'hello.txt': 'hi', 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' }));

writeFileSync(join(OUT, 'index.json'), JSON.stringify({ decks }, null, 1));
console.log(decks.length, 'decks');
