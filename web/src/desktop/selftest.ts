/**
 * What the shell's `--self-test` reaches into. Installed only when the shell asks for it
 * (`WindowInfo.selfTest`); every answer is plain data, because the shell reads it with
 * `runJavaScript`, which does not wait for a promise. Something that takes a while is started
 * here and its answer read later with `result(key)`.
 */

import { runCommand } from './commands';
import type { Host } from './host';
import { currentSession } from './session';
import type { DocsContext } from '../docs/modules/types';
import type { SheetsContext } from '../sheets/modules/types';
import type { SlidesContext } from '../slides/modules/types';

declare global {
  interface Window {
    __selftest?: Record<string, (...args: never[]) => unknown>;
  }
}

function a1(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) throw new Error(`not a cell: ${ref}`);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export function installSelfTest(host: Host): void {
  const results = new Map<string, unknown>();
  const later = (key: string, p: Promise<unknown>) => {
    results.set(key, { pending: true });
    p.then(
      (value) => results.set(key, { value }),
      (e: unknown) => results.set(key, { error: String(e) })
    );
  };
  const docs = () => currentSession()?.ctx as DocsContext | null;
  const sheets = () => currentSession()?.ctx as SheetsContext | null;
  const slides = () => currentSession()?.ctx as SlidesContext | null;

  window.__selftest = {
    where: () => (document.querySelector('[data-start]') ? 'start' : (currentSession()?.kind ?? 'loading')),
    ready: () => {
      const s = currentSession();
      if (!s) return Boolean(document.querySelector('[data-start]'));
      if (s.kind === 'docs') return Boolean(docs()?.editor) && s.isArmed;
      if (s.kind === 'slides') return Boolean(slides()?.model) && s.isArmed;
      return Boolean(sheets()?.model.status().loaded) && s.isArmed;
    },
    session: () => {
      const s = currentSession();
      return s ? { kind: s.kind, title: s.title, path: s.path, dirty: s.dirty, state: s.state } : null;
    },
    typeText: (text: string) => {
      currentSession()?.arm();
      return docs()?.editor?.chain().focus('end').insertContent(String(text)).run() ?? false;
    },
    docText: () => docs()?.editor?.getText() ?? null,
    images: () => Array.from(document.querySelectorAll('.ProseMirror img')).map((i) => (i.getAttribute('src') ?? '').slice(0, 22)),
    setCell: (ref: string, text: string) => {
      const c = sheets();
      if (!c) return false;
      currentSession()?.arm();
      return c.model.input(c.sheetId, a1(String(ref)), String(text));
    },
    cellText: (ref: string) => {
      const c = sheets();
      if (!c) return null;
      const { row, col } = a1(String(ref));
      return c.model.view(c.sheetId).cell(row, col)?.text ?? '';
    },
    slideCount: () => slides()?.model.order().length ?? null,
    /** Type over the first box of the slide on screen. */
    setSlideText: (text: string) => {
      const c = slides();
      const el = c?.slideId ? c.model.slide(c.slideId)?.elements.find((e) => e.type === 'shape') : undefined;
      if (!c || !c.slideId || !el?.id) return false;
      currentSession()?.arm();
      return c.model.setText(c.slideId, el.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text) }] }] });
    },
    deckText: () => {
      const c = slides();
      if (!c) return null;
      const out: string[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'text' && typeof x === 'string' ? out.push(x) : walk(x);
      };
      walk(c.model.deck());
      return out.join(' ');
    },
    slidePictures: () => Array.from(document.querySelectorAll('.sl-image img')).map((i) => (i.getAttribute('src') ?? '').slice(0, 5)),
    run: (key: string, id: string) => {
      const s = currentSession();
      later(String(key), s ? runCommand(s, String(id)) : Promise.resolve(false));
      return true;
    },
    clipboard: (key: string, text: string) => {
      later(
        String(key),
        navigator.clipboard.writeText(String(text)).then(() => navigator.clipboard.readText())
      );
      return true;
    },
    result: (key: string) => results.get(String(key)) ?? null,
    log: (message: string) => {
      host.log('info', String(message));
      return true;
    }
  };
}
