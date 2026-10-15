/**
 * What the page view knows that React draws: the page setup as the document says it, the
 * page count and the caret's page, the header being edited, and the last pass's timings.
 *
 * One per editor, in the pagination extension's storage. The plugin view writes it and
 * calls `emit`; the footer and the dialogs read it with `useSyncExternalStore`, keyed on
 * `version`, so a keystroke that changes none of it renders nothing.
 */

import type { Editor } from '@tiptap/core';
import type { HFKind, HFVariant } from './headerFooter';
import { defaultSetup, type PageGeometry, type PageSetup, type SetupPatch } from './setup';

export interface LayoutInfo {
  pageCount: number;
  /** Zero-based. Null in web layout. */
  caretPage: number | null;
  /** Print layout on screen now: the document's choice, a reader's own, or off on a phone. */
  paged: boolean;
}

export interface HFState {
  kind: HFKind;
  variant: HFVariant;
  page: number;
  editor: Editor;
}

/** One layout pass, in milliseconds. */
export interface PassStats {
  reason: string;
  full: boolean;
  ms: number;
  /** Before the first read: header and footer heights, note bodies, the page's variables. */
  prepMs: number;
  measureMs: number;
  flowMs: number;
  applyMs: number;
  nodes: number;
  read: number;
  lines: number;
  lineHits: number;
  units: number;
  breaks: number;
  pages: number;
  dispatched: boolean;
}

/** What the plugin view does when asked from outside it: a command, the dialog, the toolbar. */
export interface PageControl {
  /** Write a change to the page setup. False where this person cannot write. */
  setSetup: (patch: SetupPatch) => boolean;
  /** Print layout or web layout: written for everyone by an editor, kept to this tab for a reader. */
  setPaged: (paged: boolean) => void;
  editHeaderFooter: (kind: HFKind, page?: number) => boolean;
  closeHeaderFooter: () => void;
  relayout: () => void;
  canWrite: () => boolean;
}

export class PageStore {
  setup: PageSetup = defaultSetup();
  info: LayoutInfo = { pageCount: 1, caretPage: 0, paged: true };
  hf: HFState | null = null;
  /** The document's title, for the title field. Set by the footer, which has the meta. */
  title = '';
  /** The room's state has arrived (or there is no room): the paper default may be written. */
  synced = false;
  /** A reader's own choice of view. They cannot write the document, so it stays in this tab. */
  localPaged: boolean | null = null;
  /** Below 760px there is no print layout. */
  narrow = false;
  dialog = false;
  last: PassStats | null = null;
  /** The last pass's page geometry, in CSS pixels: for the performance harness's audit. */
  geo: PageGeometry | null = null;
  /** Passes run, and full re-reads that found a stale cache. For the performance harness. */
  passes = 0;
  verifyFixes = 0;
  control: PageControl | null = null;
  version = 0;
  private subs = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  };

  snapshot = (): number => this.version;

  emit(): void {
    this.version++;
    for (const cb of this.subs) cb();
  }
}
