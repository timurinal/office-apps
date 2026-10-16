import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64 } from '../crypto/primitives';
import {
  cloudClient,
  localClient,
  parseImport,
  parseLocalFile,
  parseRecentFiles,
  parseSaveResult,
  waitForBridge
} from './bridge';
import { isDesktopUA } from './detect';
import { NEVER, fakeHost } from './testing';

const APP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.12.0 Chrome/130.0 Safari/537.36 OfficeCompanion/0.1.0';
const WEB_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';


const recent = (over: Record<string, unknown> = {}) => ({ key: 'k1', name: 'Budget.xlsx', folder: '~/Documents', format: 'xlsx', modified: 1_760_000_000_000, ...over });

afterEach(() => {
  vi.useRealTimers();
});

describe('finding the app', () => {
  it('knows the app by its user agent, and nothing else', () => {
    expect(isDesktopUA(APP_UA)).toBe(true);
    expect(isDesktopUA(WEB_UA)).toBe(false);
    expect(isDesktopUA('')).toBe(false);
  });

  it('never waits on the web', async () => {
    const win = { navigator: { userAgent: WEB_UA }, officeDesktop: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    await expect(waitForBridge(win as unknown as Window)).resolves.toBeNull();
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it('takes the object when the channel is already there', async () => {
    const obj = { version: '1' };
    const win = { navigator: { userAgent: APP_UA }, officeDesktop: obj, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    await expect(waitForBridge(win as unknown as Window)).resolves.toBe(obj);
  });

  it('waits for the officedesktop event', async () => {
    const target = new EventTarget();
    const win = Object.assign(target, { navigator: { userAgent: APP_UA } }) as unknown as Window & { officeDesktop?: unknown };
    const found = waitForBridge(win);
    const obj = { version: '1' };
    win.officeDesktop = obj;
    target.dispatchEvent(new Event('officedesktop'));
    await expect(found).resolves.toBe(obj);
  });

  it('carries on as the web after 3 s', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const win = Object.assign(target, { navigator: { userAgent: APP_UA } }) as unknown as Window;
    const found = waitForBridge(win);
    vi.advanceTimersByTime(2999);
    let settled = false;
    void found.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(found).resolves.toBeNull();
  });
});

describe('what the shell sends, checked', () => {
  it('reads recent files and drops the malformed ones', () => {
    const list = [recent(), recent({ key: 'k2', format: 'exe' }), recent({ key: '' }), recent({ key: 'k3', modified: 'yesterday' }), recent({ key: 'k4', name: 'Notes.md', format: 'md' }), 'x', null];
    const out = parseRecentFiles(JSON.stringify(list));
    expect(out.map((r) => r.key)).toEqual(['k1', 'k4']);
    expect(out[0]).toEqual(recent());
  });

  it('answers no recent files for anything that is not a list', () => {
    expect(parseRecentFiles('not json')).toEqual([]);
    expect(parseRecentFiles('{"key":"k"}')).toEqual([]);
    expect(parseRecentFiles(undefined)).toEqual([]);
    expect(parseRecentFiles(42)).toEqual([]);
  });

  it('keeps at most 20 recent files', () => {
    const many = Array.from({ length: 30 }, (_, i) => recent({ key: `k${i}` }));
    expect(parseRecentFiles(JSON.stringify(many))).toHaveLength(20);
  });

  it('reads the tab’s file, with its bytes decoded', () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const f = parseLocalFile(JSON.stringify({ kind: 'docs', name: 'Letter.docx', format: 'docx', data: toBase64(bytes), readOnly: false, draft: null }));
    expect(f).toEqual({ kind: 'docs', name: 'Letter.docx', format: 'docx', data: bytes, readOnly: false, draft: null });
  });

  it('reads a new tab, which has no file behind it', () => {
    const f = parseLocalFile(JSON.stringify({ kind: 'slides', name: 'Presentation 1', format: null, data: null, readOnly: false, draft: null }));
    expect(f).toEqual({ kind: 'slides', name: 'Presentation 1', format: null, data: null, readOnly: false, draft: null });
  });

  it('reads a draft', () => {
    const draft = new Uint8Array([1, 2, 3]);
    const f = parseLocalFile(JSON.stringify({ kind: 'sheets', name: 'A.csv', format: 'csv', data: toBase64(new Uint8Array([65])), readOnly: true, draft: toBase64(draft) }));
    expect(f?.draft).toEqual(draft);
    expect(f?.readOnly).toBe(true);
  });

  // `draft("")` is how a page drops a recovery it was offered; a shell that kept it anyway hands back nothing.
  it('reads an empty draft as none', () => {
    const f = parseLocalFile(JSON.stringify({ kind: 'docs', name: 'A.docx', format: 'docx', data: 'UEsDBA==', readOnly: false, draft: '' }));
    expect(f?.draft).toBeNull();
  });

  it('treats a malformed file as absent', () => {
    const good = { kind: 'docs', name: 'Letter.docx', format: 'docx', data: 'UEsDBA==', readOnly: false, draft: null };
    expect(parseLocalFile(JSON.stringify(good))).not.toBeNull();
    expect(parseLocalFile('')).toBeNull();
    expect(parseLocalFile('{')).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, kind: 'mail' }))).toBeNull();
    // A spreadsheet's format with the Docs editor would open nothing sensible.
    expect(parseLocalFile(JSON.stringify({ ...good, format: 'xlsx' }))).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, data: '***' }))).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, data: null }))).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, name: '' }))).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, readOnly: 'no' }))).toBeNull();
    expect(parseLocalFile(JSON.stringify({ ...good, draft: 7 }))).toBeNull();
  });

  it('reads a save’s answer, and anything it cannot read is a failure', () => {
    expect(parseSaveResult('{"ok":true,"name":"Letter.docx","format":"docx"}')).toEqual({ ok: true, name: 'Letter.docx', format: 'docx' });
    expect(parseSaveResult('{"ok":false,"error":"cancelled"}')).toEqual({ ok: false, error: 'cancelled' });
    expect(parseSaveResult('{"ok":false,"error":"too_large"}')).toEqual({ ok: false, error: 'too_large' });
    expect(parseSaveResult('{"ok":false,"error":"disk on fire"}')).toEqual({ ok: false, error: 'failed' });
    expect(parseSaveResult('{"ok":true,"name":"Letter.exe","format":"exe"}')).toEqual({ ok: false, error: 'failed' });
    expect(parseSaveResult('nope')).toEqual({ ok: false, error: 'failed' });
    expect(parseSaveResult(undefined)).toEqual({ ok: false, error: 'failed' });
  });

  it('reads an upload waiting for the cloud page', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    expect(parseImport(JSON.stringify({ name: 'Deck.pptx', format: 'pptx', data: toBase64(bytes) }))).toEqual({ name: 'Deck.pptx', format: 'pptx', data: bytes });
    expect(parseImport('')).toBeNull();
    expect(parseImport(JSON.stringify({ name: 'Deck.pptx', format: 'key', data: 'AA==' }))).toBeNull();
    expect(parseImport(JSON.stringify({ name: 'Deck.pptx', format: 'pptx', data: '' }))).toBeNull();
  });
});

describe('the cloud object', () => {
  it('is absent when a member is missing', () => {
    const { raw } = fakeHost();
    delete raw.takeImport;
    expect(cloudClient(raw)).toBeNull();
    expect(cloudClient(null)).toBeNull();
    expect(cloudClient('officeDesktop')).toBeNull();
  });

  it('answers through callbacks, checked', async () => {
    const { raw, calls } = fakeHost({ recentFiles: JSON.stringify([recent()]), openRecent: 'missing', takeImport: JSON.stringify({ name: 'A.md', format: 'md', data: 'IyBB' }) });
    const c = cloudClient(raw)!;
    expect(c.version).toBe('0.1.0');
    await expect(c.recentFiles()).resolves.toEqual([recent()]);
    await expect(c.openRecent('k1')).resolves.toBe('missing');
    await expect(c.takeImport('n0nce')).resolves.toEqual({ name: 'A.md', format: 'md', data: new Uint8Array([35, 32, 65]) });
    expect(calls.find((x) => x.name === 'takeImport')?.args).toEqual(['n0nce']);
  });

  it('opens only the paths the contract names in a new tab', () => {
    const { raw, calls } = fakeHost();
    const c = cloudClient(raw)!;
    for (const p of ['/', '/docs/a1', '/sheets/B_2-c', '/slides/x', '/l/tok-en']) c.openTab(p);
    for (const p of ['/settings', '//evil.example/docs/a', '/docs/a?x=1', '/docs/', 'https://office.example.com/docs/a', '/docs/a/b']) c.openTab(p);
    expect(calls.filter((x) => x.name === 'openTab').map((x) => x.args[0])).toEqual(['/', '/docs/a1', '/sheets/B_2-c', '/slides/x', '/l/tok-en']);
  });

  it('sends a theme only when it is one', () => {
    const { raw, calls } = fakeHost();
    const c = cloudClient(raw)!;
    c.setTheme('dark');
    c.setTheme('sepia' as 'dark');
    expect(calls.filter((x) => x.name === 'setTheme').map((x) => x.args)).toEqual([['dark']]);
  });

  it('does not wait forever for a quick answer', async () => {
    vi.useFakeTimers();
    const { raw } = fakeHost({ recentFiles: NEVER });
    const c = cloudClient(raw)!;
    const out = c.recentFiles();
    vi.advanceTimersByTime(10_000);
    await expect(out).resolves.toEqual([]);
  });

  it('carries on when the object throws', async () => {
    const { raw } = fakeHost();
    raw.recentFiles = () => {
      throw new Error('gone');
    };
    await expect(cloudClient(raw)!.recentFiles()).resolves.toEqual([]);
  });
});

describe('the local object', () => {
  it('is absent without its signal', () => {
    const { raw } = fakeHost();
    raw.saveRequested = {};
    expect(localClient(raw)).toBeNull();
  });

  it('sends bytes as base64 and reads the answer', async () => {
    const { raw, calls } = fakeHost({ save: '{"ok":true,"name":"A.docx","format":"docx"}', saveAs: '{"ok":false,"error":"cancelled"}' });
    const c = localClient(raw)!;
    await expect(c.save(new Uint8Array([1, 2, 3]))).resolves.toEqual({ ok: true, name: 'A.docx', format: 'docx' });
    await expect(c.saveAs(new Uint8Array([4]), 'md')).resolves.toEqual({ ok: false, error: 'cancelled' });
    c.draft(new Uint8Array([5, 6]));
    c.discardDraft();
    c.upload(new Uint8Array([7]), 'docx');
    c.setDirty(true);
    expect(calls.map((x) => [x.name, ...x.args])).toEqual([
      ['save', 'AQID'],
      ['saveAs', 'BA==', 'md'],
      ['draft', 'BQY='],
      ['draft', ''],
      ['upload', 'Bw==', 'docx'],
      ['setDirty', true]
    ]);
  });

  it('waits as long as the person takes in the Save dialog', async () => {
    vi.useFakeTimers();
    const later: { cb?: (v: unknown) => void } = {};
    const { raw } = fakeHost();
    raw.saveAs = (_d: string, _f: string, cb: (v: unknown) => void) => (later.cb = cb);
    const out = localClient(raw)!.saveAs(new Uint8Array([1]), 'docx');
    vi.advanceTimersByTime(10 * 60_000);
    later.cb!('{"ok":true,"name":"A.docx","format":"docx"}');
    await expect(out).resolves.toEqual({ ok: true, name: 'A.docx', format: 'docx' });
  });

  it('reads the file, and an unreadable answer is no file', async () => {
    const { raw } = fakeHost({ file: '{"kind":"docs"}' });
    await expect(localClient(raw)!.file()).resolves.toBeNull();
  });

  it('hears Save from the shell until it stops listening', () => {
    const { raw, fire, listeners } = fakeHost();
    const c = localClient(raw)!;
    const heard = vi.fn();
    const stop = c.onSaveRequested(heard);
    fire();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
    fire();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
