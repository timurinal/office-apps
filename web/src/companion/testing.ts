/**
 * A QWebChannel object as the page sees one, for a test: each invokable answers through a callback,
 * a microtask later, and every call is recorded. `answers` holds what a member answers, or a function
 * of its arguments that does; `NEVER` is a member that never answers.
 */

export const NEVER = Symbol('never');

const MEMBERS = ['setTheme', 'recentFiles', 'openFile', 'openRecent', 'newLocal', 'openTab', 'takeImport', 'file', 'save', 'saveAs', 'setDirty', 'draft', 'upload'];

export function fakeHost(answers: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const listeners = new Set<() => void>();
  const member =
    (name: string) =>
    (...args: unknown[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as (v: unknown) => void) : null;
      calls.push({ name, args });
      const answer = answers[name];
      if (cb && answer !== undefined && answer !== NEVER) queueMicrotask(() => cb(typeof answer === 'function' ? (answer as (...a: unknown[]) => unknown)(...args) : answer));
    };
  const raw: Record<string, unknown> = { version: '0.1.0' };
  for (const n of MEMBERS) raw[n] = member(n);
  raw.saveRequested = {
    connect: (fn: () => void) => listeners.add(fn),
    disconnect: (fn: () => void) => listeners.delete(fn)
  };
  /** The calls to one member, by their arguments. */
  const of = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);
  return { raw, calls, of, fire: () => listeners.forEach((l) => l()), listeners };
}
