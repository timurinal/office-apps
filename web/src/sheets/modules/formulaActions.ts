/**
 * The Formulas tab: putting a function into a formula, and defined names.
 *
 * A name is stored once for the workbook (`names`, structure.ts) as `{name, scope?, f}`: `f` is the
 * formula with its references pinned to ids, and `scope` a sheet id for a name that only that sheet
 * sees. Everything here talks A1 to the person and lets the engine turn it into ids, so a name
 * survives an insert or a delete as a formula does.
 */

import { rectAddress } from '../grid/a1';
import type { Rect } from '../grid/types';
import { namesOf } from '../model/structure';
import type { ActionContext } from './actions';

type Ctx = Pick<ActionContext, 'model' | 'sheetId'>;

// ── inserting a function ────────────────────────────────────────────────────

/**
 * Puts `NAME(` where the person is typing, or starts typing it in the active cell. In a cell that
 * is being edited it goes at the caret, replacing what is selected, so `=` becomes `=SUM(`. Returns
 * false where the sheet is read only.
 */
export function insertFunction(c: Pick<ActionContext, 'session'>, name: string): boolean {
  const { session } = c;
  const call = `${name}(`;
  const e = session.edit;
  if (e) {
    const from = Math.min(e.selStart, e.selEnd);
    const to = Math.max(e.selStart, e.selEnd);
    const text = e.text === '' ? `=${call}` : e.text.slice(0, from) + call + e.text.slice(to);
    const caret = (e.text === '' ? 1 : from) + call.length;
    session.input(text, caret, caret, e.focus);
  } else if (!session.beginEdit('type', `=${call}`)) return false;
  // The cell's editor is always mounted, so it can take the keyboard in the same breath.
  document.querySelector<HTMLTextAreaElement>(`[data-sg-editor="${session.id}"] textarea`)?.focus({ preventScroll: true });
  return true;
}

// ── names ───────────────────────────────────────────────────────────────────

export interface NameRow {
  name: string;
  /** A sheet id, or undefined for a name the whole workbook sees. */
  scope?: string;
  /** Where it reads: `Sheet1!$A$1:$B$4`, or the formula. */
  refersTo: string;
  /** The sheet's name, or "Workbook". */
  scopeLabel: string;
}

export const WORKBOOK = 'Workbook';

/** Every defined name, by name, a workbook-wide one before a sheet's own of the same name. */
export function listNames(c: Ctx): NameRow[] {
  const sheets = new Map(c.model.sheets().map((s) => [s.id, s.name]));
  const rows: NameRow[] = [];
  for (const n of namesOf(c.model.doc).values()) {
    if (n.scope !== undefined && !sheets.has(n.scope)) continue;
    const shown = c.model.engine.displayName(n.name, n.scope);
    rows.push({
      name: n.name,
      ...(n.scope === undefined ? {} : { scope: n.scope }),
      refersTo: shown === undefined ? '' : shown.startsWith('=') ? shown : `=${shown}`,
      scopeLabel: n.scope === undefined ? WORKBOOK : (sheets.get(n.scope) ?? '')
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.scope === undefined ? -1 : 1));
}

export interface NameDraft {
  name: string;
  scope?: string;
  /** A1 text: `=Sheet1!$A$1:$B$4`, `=0.2`, or a formula. */
  refersTo: string;
  /** The name being edited, so saving it does not clash with itself. */
  replaces?: { name: string; scope?: string };
}

const same = (a: { name: string; scope?: string | undefined }, b: { name: string; scope?: string | undefined }) =>
  a.name.toLowerCase() === b.name.toLowerCase() && a.scope === b.scope;

/** Why a name could not be saved, or null when it can. Nothing is written. */
export function checkName(c: Ctx, d: NameDraft): string | null {
  const name = d.name.trim();
  if (!name) return 'Type a name.';
  if (!d.refersTo.trim() || d.refersTo.trim() === '=') return 'Say what the name stands for.';
  const clash = listNames(c).find((n) => same(n, { name, ...(d.scope === undefined ? {} : { scope: d.scope }) }));
  if (clash && !(d.replaces && same(clash, d.replaces))) return `There is already a name called ${name}.`;
  const r = c.model.engine.nameFromInput(name, d.scope, d.refersTo, d.scope ?? c.sheetId);
  if (r.kind === 'error') return r.message;
  return null;
}

/** Saves a name, or says why not. Editing one replaces it, so a rename and a change of scope are one step. */
export function saveName(c: ActionContext, d: NameDraft): { ok: true } | { ok: false; message: string } {
  const message = checkName(c, d);
  if (message) return { ok: false, message };
  const name = d.name.trim();
  let saved = false;
  c.model.batch(() => {
    if (d.replaces && !same(d.replaces, { name, ...(d.scope === undefined ? {} : { scope: d.scope }) })) c.model.removeName(d.replaces.name, d.replaces.scope);
    saved = c.model.setName(name, d.refersTo, d.scope);
  });
  return saved ? { ok: true } : { ok: false, message: 'That name could not be saved.' };
}

export function deleteName(c: ActionContext, name: string, scope?: string): void {
  c.model.removeName(name, scope);
}

/** The selection as a reference to type into a name: `Sheet1!$B$2:$D$9`. */
export function selectionRef(c: Ctx, r: Rect): string {
  const sheet = c.model.sheets().find((s) => s.id === c.sheetId);
  const name = sheet?.name ?? 'Sheet1';
  const a1 = rectAddress(r).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
  return `=${/^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`}!${a1}`;
}
