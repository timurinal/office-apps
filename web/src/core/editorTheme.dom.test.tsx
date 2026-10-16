// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocKind } from '@shared/api';
import { RouterProvider } from '../router';
import { setAppearance, type Appearance } from './appearance';
import { DocumentMessage } from './EditorFrame';
import { fileTextIcon } from './icons';
import { EditorShell } from './shell/EditorShell';
import { AppKindProvider, Modal, ToastHost, useNotify } from './ui';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Slides wears the page's resolved theme, and says it on its own element because its stylesheet's
 * unmarked roles are the dark ones: under System it is light on a light system and dark on a dark one.
 * Docs and Sheets wear whatever the page does, so they set nothing of their own. Everything drawn
 * outside the shell's tree (a dialog, a toast, the skeleton) has to say the same.
 */

let systemDark = false;
const realMatchMedia = window.matchMedia;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  if (typeof ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
  systemDark = false;
  window.matchMedia = ((q: string) => ({ matches: q.includes('dark') && systemDark, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-scrim').forEach((n) => n.remove());
  setAppearance('system');
  localStorage.clear();
  window.matchMedia = realMatchMedia;
});

const shell = (kind: DocKind) => (
  <RouterProvider>
    <EditorShell
      kind={kind}
      header={{ title: 'T', titleEditable: false, onRename: () => undefined, badgeIcon: fileTextIcon, people: [] }}
      search={null}
      ribbon={{ tabs: [{ id: 'home', label: 'Home' }], groups: [], ctx: {}, active: 'home', onActive: () => undefined, fileMenu: null, subscribe: () => () => undefined }}
    >
      <div />
    </EditorShell>
  </RouterProvider>
);

const themeOf = (sel = '.oa-shell') => host.querySelector(sel)?.getAttribute('data-theme') ?? null;

const CASES: [Appearance, string | null][] = [
  ['system', 'light'],
  ['dark', 'dark'],
  ['light', 'light']
];

describe('the editor shell', () => {
  it.each(CASES)('is the theme Slides wears under %s: %s', (appearance, expected) => {
    setAppearance(appearance);
    act(() => root.render(shell('slides')));
    expect(themeOf()).toBe(expected);
  });

  it.each(['docs', 'sheets'] as const)('leaves %s to the page under every choice', (kind) => {
    for (const a of ['system', 'light', 'dark'] as const) {
      setAppearance(a);
      act(() => root.render(shell(kind)));
      expect(themeOf(), `${kind} under ${a}`).toBeNull();
    }
  });

  it('follows the choice while it is open', () => {
    setAppearance('system');
    act(() => root.render(shell('slides')));
    expect(themeOf()).toBe('light');
    act(() => setAppearance('dark'));
    expect(themeOf()).toBe('dark');
    act(() => setAppearance('light'));
    expect(themeOf()).toBe('light');
  });

  it('is dark under System when the system is dark', () => {
    systemDark = true;
    act(() => setAppearance('light'));
    act(() => setAppearance('system'));
    act(() => root.render(shell('slides')));
    expect(themeOf()).toBe('dark');
  });
});

describe('what is drawn outside it', () => {
  it.each(CASES)('a message wears the same theme under %s', (appearance, expected) => {
    setAppearance(appearance);
    act(() => root.render(<DocumentMessage kind="slides" title="x" />));
    expect(themeOf()).toBe(expected);
  });

  it.each(CASES)('the skeleton wears it under %s', (appearance, expected) => {
    setAppearance(appearance);
    act(() => root.render(<DocumentSkeleton kind="slides" />));
    expect(themeOf('.oa-skel')).toBe(expected);
  });

  it('a Docs message and skeleton set no theme of their own', () => {
    setAppearance('light');
    act(() => root.render(<DocumentMessage kind="docs" title="x" />));
    expect(themeOf()).toBeNull();
    act(() => root.render(<DocumentSkeleton kind="docs" />));
    expect(themeOf('.oa-skel')).toBeNull();
  });

  it.each(CASES)('a dialog over Slides wears it under %s', (appearance, expected) => {
    setAppearance(appearance);
    act(() =>
      root.render(
        <RouterProvider>
          <ToastHost>
            <AppKind kind="slides">
              <Modal title="Hello" onClose={() => undefined}>
                <p>body</p>
              </Modal>
            </AppKind>
          </ToastHost>
        </RouterProvider>
      )
    );
    expect(document.body.querySelector('.oa-scrim')?.getAttribute('data-theme')).toBe(expected);
  });

  it.each(CASES)('a toast in Slides wears it under %s', (appearance, expected) => {
    setAppearance(appearance);
    function Shout() {
      const notify = useNotify();
      return <button onClick={() => notify({ text: 'Saved' })}>go</button>;
    }
    act(() =>
      root.render(
        <AppKind kind="slides">
          <ToastHost>
            <Shout />
          </ToastHost>
        </AppKind>
      )
    );
    act(() => host.querySelector('button')!.click());
    expect(document.body.querySelector('.oa-toast')?.getAttribute('data-theme')).toBe(expected);
  });
});

function AppKind({ kind, children }: { kind: DocKind; children: React.ReactNode }) {
  return <AppKindProvider value={kind}>{children}</AppKindProvider>;
}
