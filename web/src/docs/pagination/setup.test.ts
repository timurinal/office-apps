import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  GAP,
  MARGIN_PRESETS,
  PAGE_MAP,
  PAGE_ORIGIN,
  defaultSetup,
  defaultSize,
  geometry,
  insetFor,
  marginsFit,
  mmToPx,
  pageRule,
  paperMM,
  patchEntries,
  presetOf,
  readSetup,
  writeSetup
} from './setup';

const mapOf = (entries: Record<string, unknown>): Y.Map<unknown> => {
  const doc = new Y.Doc();
  const map = doc.getMap<unknown>(PAGE_MAP);
  for (const [k, v] of Object.entries(entries)) map.set(k, v);
  return map;
};

describe('the paper default', () => {
  it('is Letter in en-US and A4 everywhere else', () => {
    expect(defaultSize('en-US')).toBe('Letter');
    expect(defaultSize('en-us')).toBe('Letter');
    expect(defaultSize('en-GB')).toBe('A4');
    expect(defaultSize('de')).toBe('A4');
    expect(defaultSize(undefined)).toBe('A4');
  });

  it('has Normal margins, portrait, print layout and one header for every page', () => {
    const s = defaultSetup('A4');
    expect(s).toMatchObject({ size: 'A4', orientation: 'portrait', paged: true, differentFirst: false });
    expect(presetOf(s.margins)).toBe('normal');
  });
});

describe('readSetup', () => {
  it('reads what was written', () => {
    const s = readSetup(
      mapOf({ size: 'Legal', orientation: 'landscape', marginTop: 10, marginRight: 11, marginBottom: 12, marginLeft: 13, headerDistance: 5, footerDistance: 6, differentFirst: true, paged: false }),
      'A4'
    );
    expect(s).toEqual({
      size: 'Legal',
      orientation: 'landscape',
      margins: { top: 10, right: 11, bottom: 12, left: 13 },
      headerDistance: 5,
      footerDistance: 6,
      differentFirst: true,
      paged: false
    });
  });

  it('takes the fallback paper for an empty map, or none at all', () => {
    expect(readSetup(mapOf({}), 'Letter').size).toBe('Letter');
    expect(readSetup(null, 'A4')).toEqual(defaultSetup('A4'));
  });

  it('never lets a bad value reach the layout', () => {
    const s = readSetup(
      mapOf({ size: 'Tabloid', orientation: 'sideways', marginTop: Number.NaN, marginRight: -4, marginBottom: '20', marginLeft: 1e9, headerDistance: 500, differentFirst: 'yes', paged: 0 }),
      'A4'
    );
    const d = defaultSetup('A4');
    expect(s.size).toBe('A4');
    expect(s.orientation).toBe('portrait');
    expect(s.margins).toEqual(d.margins);
    expect(s.headerDistance).toBe(d.headerDistance);
    expect(s.differentFirst).toBe(false);
    // Only `false` turns print layout off.
    expect(s.paged).toBe(true);
  });

  it('drops margins that leave no body, all four together', () => {
    const s = readSetup(mapOf({ size: 'A5', marginLeft: 70, marginRight: 70 }), 'A4');
    expect(s.margins).toEqual(defaultSetup('A4').margins);
  });
});

describe('margins', () => {
  it('fit when they leave at least 25 mm of body each way', () => {
    expect(marginsFit({ size: 'A4', orientation: 'portrait' }, { top: 25, right: 25, bottom: 25, left: 25 })).toBe(true);
    expect(marginsFit({ size: 'A4', orientation: 'portrait' }, { top: 25, right: 92.5, bottom: 25, left: 92.5 })).toBe(true);
    expect(marginsFit({ size: 'A4', orientation: 'portrait' }, { top: 25, right: 93, bottom: 25, left: 93 })).toBe(false);
    // Turned, the same margins fit across the long side.
    expect(marginsFit({ size: 'A4', orientation: 'landscape' }, { top: 25, right: 93, bottom: 25, left: 93 })).toBe(true);
    expect(marginsFit({ size: 'A4', orientation: 'portrait' }, { top: -1, right: 25, bottom: 25, left: 25 })).toBe(false);
    expect(marginsFit({ size: 'A4', orientation: 'portrait' }, { top: Number.NaN, right: 25, bottom: 25, left: 25 })).toBe(false);
  });

  it('name their preset, within rounding, and no preset for anything else', () => {
    for (const p of MARGIN_PRESETS) expect(presetOf(p.margins)).toBe(p.id);
    expect(presetOf({ top: 25.42, right: 25.4, bottom: 25.4, left: 25.4 })).toBe('normal');
    expect(presetOf({ top: 20, right: 20, bottom: 20, left: 20 })).toBeNull();
  });
});

describe('writing the map', () => {
  it('names a key for each field that changes, rounded to a hundredth of a millimetre', () => {
    expect(patchEntries({ orientation: 'landscape' })).toEqual([['orientation', 'landscape']]);
    expect(patchEntries({ margins: { top: 25.4001, right: 1, bottom: 2, left: 3 } })).toEqual([
      ['marginTop', 25.4],
      ['marginRight', 1],
      ['marginBottom', 2],
      ['marginLeft', 3]
    ]);
    expect(patchEntries({})).toEqual([]);
  });

  it('writes one update under its own origin, and none for a value already there', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    expect(writeSetup(doc, { size: 'A5', paged: false })).toBe(true);
    expect(origins).toEqual([PAGE_ORIGIN]);
    expect(writeSetup(doc, { size: 'A5', paged: false })).toBe(false);
    expect(origins).toHaveLength(1);
    expect(readSetup(doc.getMap(PAGE_MAP), 'A4')).toMatchObject({ size: 'A5', paged: false });
  });
});

describe('to pixels', () => {
  it('converts at 96 per inch, to the browser’s 1/64 px', () => {
    expect(mmToPx(25.4)).toBe(96);
    expect(mmToPx(297) * 64).toBe(Math.round(mmToPx(297) * 64));
    expect(Math.abs(mmToPx(297) - (297 * 96) / 25.4)).toBeLessThan(1 / 128);
  });

  it('turns the paper for landscape', () => {
    expect(paperMM({ size: 'Letter', orientation: 'portrait' })).toEqual({ w: 215.9, h: 279.4 });
    expect(paperMM({ size: 'Letter', orientation: 'landscape' })).toEqual({ w: 279.4, h: 215.9 });
  });

  it('pushes the body down only when a header reaches past the margin', () => {
    expect(insetFor(96, 48, 0)).toBe(96);
    expect(insetFor(96, 48, 20)).toBe(96);
    expect(insetFor(96, 48, 60)).toBe(48 + 60 + 6);
  });

  it('gives the first page its own insets when its header differs', () => {
    const g = geometry(defaultSetup('A4'), { headerFirst: 100, headerRest: 0, footerFirst: 0, footerRest: 0 });
    expect(g.setup.pageW).toBe(mmToPx(210));
    expect(g.setup.pageH).toBe(mmToPx(297));
    expect(g.setup.gap).toBe(GAP);
    expect(g.setup.topRest).toBe(96);
    expect(g.setup.topFirst).toBeGreaterThan(96);
    expect(g.left).toBe(96);
  });

  it('prints at the paper size, with no margin in print layout and the page’s own in web layout', () => {
    const s = { ...defaultSetup('A4'), orientation: 'landscape' as const };
    expect(pageRule(s, true)).toBe('@page { size: 297mm 210mm; margin: 0; }');
    expect(pageRule(s, false)).toBe('@page { size: 297mm 210mm; margin: 25.4mm 25.4mm 25.4mm 25.4mm; }');
  });
});
