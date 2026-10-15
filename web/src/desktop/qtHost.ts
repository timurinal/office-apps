/**
 * The Qt shell, over QWebChannel. The shell registers one object, `host`, per window:
 *
 *     call(requestId, method, argsJson)      every request; requestId '' wants no answer
 *     reply(requestId, json)                 { ok: true, value } | { ok: false, error: { code, message } }
 *     command(name, json)                    the menu bar, the close button, the window going to the back
 *
 * Everything is JSON, bytes as base64. The shell's side is `shell/officeapps/bridge.py`.
 */

import { fromBase64, HostError, toBase64, type Host, type HostCommand, type HostErrorCode, type RecentFile, type SaveResult, type WindowInfo } from './host';

interface Signal<A extends unknown[]> {
  connect(cb: (...args: A) => void): void;
}

interface QtObject {
  call(requestId: string, method: string, args: string): void;
  reply: Signal<[string, string]>;
  command: Signal<[string, string]>;
}

type Reply = { ok: true; value: unknown } | { ok: false; error: { code: HostErrorCode; message: string } };

export function qtHost(raw: unknown): Host {
  const obj = raw as QtObject;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Set<(name: HostCommand, args: Record<string, unknown>) => void>();
  let seq = 0;

  obj.reply.connect((id, json) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    const r = JSON.parse(json) as Reply;
    if (r.ok) p.resolve(r.value);
    else p.reject(new HostError(r.error.code, r.error.message));
  });
  obj.command.connect((name, json) => {
    const args = (json ? JSON.parse(json) : {}) as Record<string, unknown>;
    for (const l of listeners) l(name as HostCommand, args);
  });

  const call = <T>(method: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = `r${++seq}`;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      obj.call(id, method, JSON.stringify(args));
    });
  const fire = (method: string, args: Record<string, unknown> = {}): void => obj.call('', method, JSON.stringify(args));

  return {
    hello: () => call<WindowInfo>('hello'),
    readOpened: async () => fromBase64(await call<string>('readOpened')),
    setState: (state) => fire('setState', { ...state }),
    save: (bytes, opts) => call<SaveResult>('save', { data: toBase64(bytes), force: Boolean(opts?.force) }),
    saveAs: (bytes, suggestedName) => call<SaveResult | null>('saveAs', { data: toBase64(bytes), suggestedName }),
    rename: (name) => call<SaveResult>('rename', { name }),
    newDocument: (kind, templateId) => fire('newDocument', { kind, templateId: templateId ?? null }),
    open: () => fire('open'),
    openRecent: (path) => fire('openRecent', { path }),
    forgetRecent: (path) => fire('forgetRecent', { path }),
    reveal: (path) => fire('reveal', { path }),
    recents: () => call<RecentFile[]>('recents'),
    showStart: () => fire('showStart'),
    openExternal: (url) => fire('openExternal', { url }),
    close: (force) => fire('close', { force }),
    log: (level, message) => fire('log', { level, message }),
    onCommand: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
  };
}
