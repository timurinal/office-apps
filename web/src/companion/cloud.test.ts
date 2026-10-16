// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppearance } from '../core/appearance';
import type { CloudClient } from './bridge';
import { desktopUrl, importedFile, openInDesktopRow, openInNewTab } from './cloud';
import { followTheme } from './theme';

const fakeClient = (): CloudClient & { [k: string]: ReturnType<typeof vi.fn> } =>
  ({
    version: '0.1.0',
    setTheme: vi.fn(),
    recentFiles: vi.fn(async () => []),
    openFile: vi.fn(),
    openRecent: vi.fn(async () => 'opened' as const),
    newLocal: vi.fn(),
    openTab: vi.fn(),
    takeImport: vi.fn(async () => null)
  }) as unknown as CloudClient & { [k: string]: ReturnType<typeof vi.fn> };

const meta = (over: Record<string, unknown> = {}) =>
  ({ id: 'd1', kind: 'docs', role: 'owner', principal: 'user', canDownload: true, trashedAt: null, locked: false, ...over }) as never;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the address that opens the app', () => {
  it('names a document by its kind and id', () => {
    expect(desktopUrl('docs', 'abc_D-9')).toBe('office-companion://open/docs/abc_D-9');
    expect(desktopUrl('sheets', 's1')).toBe('office-companion://open/sheets/s1');
    expect(desktopUrl('slides', 'p1')).toBe('office-companion://open/slides/p1');
  });

  it('is not made for an id the app would ignore', () => {
    expect(desktopUrl('docs', '')).toBeNull();
    expect(desktopUrl('docs', 'a b')).toBeNull();
    expect(desktopUrl('docs', 'a/../b')).toBeNull();
    expect(desktopUrl('docs', 'x'.repeat(129))).toBeNull();
  });
});

describe('"Open in the desktop app"', () => {
  const ua = { mockReturnValue: (v: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(v) };

  it('is offered in a browser, and opens the app', () => {
    ua.mockReturnValue('Mozilla/5.0 Chrome/130.0');
    const go = vi.fn();
    const row = openInDesktopRow('docs', meta(), go);
    expect(row.label).toBe('Open in the desktop app');
    expect(row.visible?.(null)).toBe(true);
    row.run(null);
    expect(go).toHaveBeenCalledWith('office-companion://open/docs/d1');
  });

  it('is not offered inside the app', () => {
    ua.mockReturnValue('Mozilla/5.0 Chrome/130.0 OfficeCompanion/0.1.0');
    expect(openInDesktopRow('docs', meta()).visible?.(null)).toBe(false);
  });

  it('is not offered on a touch screen', () => {
    ua.mockReturnValue('Mozilla/5.0 Chrome/130.0');
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q === '(pointer: coarse)' }) as MediaQueryList);
    expect(openInDesktopRow('sheets', meta({ kind: 'sheets' })).visible?.(null)).toBe(false);
  });

  // A link's visitor has a grant cookie in this browser and none in the app.
  it('is not offered to a link visitor', () => {
    ua.mockReturnValue('Mozilla/5.0 Chrome/130.0');
    expect(openInDesktopRow('docs', meta({ principal: 'link', role: 'viewer' })).visible?.(null)).toBe(false);
  });
});

describe('a new tab', () => {
  it('is the app’s own tab inside the app', () => {
    const c = fakeClient();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInNewTab('/docs/d2', c);
    expect(c.openTab).toHaveBeenCalledWith('/docs/d2');
    expect(open).not.toHaveBeenCalled();
  });

  it('is the browser’s on the web', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openInNewTab('/docs/d2', null);
    expect(open).toHaveBeenCalledWith('/docs/d2', '_blank', 'noopener,noreferrer');
  });
});

describe('the theme', () => {
  it('is sent when the bridge appears and on every change, once each', () => {
    setAppearance('light');
    const c = fakeClient();
    const stop = followTheme(c);
    expect(vi.mocked(c.setTheme).mock.calls).toEqual([['light']]);
    setAppearance('dark');
    setAppearance('dark');
    setAppearance('light');
    expect(vi.mocked(c.setTheme).mock.calls).toEqual([['light'], ['dark'], ['light']]);
    stop();
    setAppearance('dark');
    expect(c.setTheme).toHaveBeenCalledTimes(3);
    setAppearance('system');
  });
});

describe('an upload from a local tab', () => {
  it('becomes a file Home imports like a dropped one', async () => {
    const f = importedFile({ name: 'Budget.xlsx', format: 'xlsx', data: new Uint8Array([1, 2, 3]) });
    expect(f.name).toBe('Budget.xlsx');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('is named for its format when its name does not say', () => {
    expect(importedFile({ name: 'Document 1', format: 'docx', data: new Uint8Array() }).name).toBe('Document 1.docx');
    expect(importedFile({ name: 'Notes.MD', format: 'md', data: new Uint8Array() }).name).toBe('Notes.MD');
    // A .csv uploaded as the workbook it became, and a .md as the document.
    expect(importedFile({ name: 'Budget.csv', format: 'xlsx', data: new Uint8Array() }).name).toBe('Budget.xlsx');
    expect(importedFile({ name: 'Notes.markdown', format: 'docx', data: new Uint8Array() }).name).toBe('Notes.docx');
    expect(importedFile({ name: 'v1.2 plan', format: 'docx', data: new Uint8Array() }).name).toBe('v1.2 plan.docx');
  });
});
