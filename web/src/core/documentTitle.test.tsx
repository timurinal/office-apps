// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocKind } from '@shared/api';
import { APP_TITLE, documentTitle, useDocumentTitle } from './documentTitle';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('documentTitle', () => {
  it('names the document and its app, with an en dash', () => {
    expect(documentTitle('Budget', 'sheets')).toBe('Budget – Sheets');
    expect(documentTitle('Minutes', 'docs')).toBe('Minutes – Docs');
    expect(documentTitle('Kick-off', 'slides')).toBe('Kick-off – Slides');
  });

  it('is the app everywhere else', () => {
    expect(documentTitle()).toBe(APP_TITLE);
    expect(documentTitle('Budget')).toBe(APP_TITLE);
    expect(documentTitle(undefined, 'docs')).toBe(APP_TITLE);
    expect(documentTitle('   ', 'docs')).toBe(APP_TITLE);
    expect(documentTitle(null, null)).toBe(APP_TITLE);
    expect(documentTitle('Budget', 'cards' as unknown as DocKind)).toBe(APP_TITLE);
  });

  it('trims the name it was given', () => {
    expect(documentTitle('  Budget  ', 'sheets')).toBe('Budget – Sheets');
  });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.title = 'Office';
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Title({ title, kind }: { title?: string | null; kind?: DocKind | null }) {
  useDocumentTitle(title, kind);
  return null;
}

describe('useDocumentTitle', () => {
  it('sets the tab title while it is mounted and puts the old one back after', () => {
    act(() => root.render(<Title title="Budget" kind="sheets" />));
    expect(document.title).toBe('Budget – Sheets');
    act(() => root.render(null));
    expect(document.title).toBe('Office');
  });

  it('follows a rename', () => {
    act(() => root.render(<Title title="Budget" kind="sheets" />));
    act(() => root.render(<Title title="Budget 2027" kind="sheets" />));
    expect(document.title).toBe('Budget 2027 – Sheets');
    act(() => root.render(<Title title="Budget 2027" kind="sheets" />));
    expect(document.title).toBe('Budget 2027 – Sheets');
  });

  it('restores whatever the page was called, not a fixed name', () => {
    document.title = 'Something else';
    act(() => root.render(<Title title="Minutes" kind="docs" />));
    expect(document.title).toBe('Minutes – Docs');
    act(() => root.render(null));
    expect(document.title).toBe('Something else');
  });

  it('is the app when it has no document', () => {
    act(() => root.render(<Title />));
    expect(document.title).toBe('Office');
  });

  // A route change mounts the next page before the last one has gone, and which of the two
  // cleans up first is up to React. The tab must end on the page that is still there.
  it('ends on the page that is still mounted, whichever one leaves first', () => {
    const second = document.body.appendChild(document.createElement('div'));
    const root2 = createRoot(second);
    act(() => root.render(<Title title="First" kind="docs" />));
    act(() => root2.render(<Title title="Second" kind="sheets" />));
    expect(document.title).toBe('Second – Sheets');

    act(() => root.render(null));
    expect(document.title).toBe('Second – Sheets');
    act(() => root2.render(null));
    expect(document.title).toBe('Office');

    act(() => root.render(<Title title="First" kind="docs" />));
    act(() => root2.render(<Title title="Second" kind="sheets" />));
    act(() => root2.render(null));
    expect(document.title).toBe('First – Docs');
    act(() => root.render(null));
    expect(document.title).toBe('Office');
    act(() => root2.unmount());
    second.remove();
  });

  it('leaves a rename of the older page alone when a newer one is on top', () => {
    const second = document.body.appendChild(document.createElement('div'));
    const root2 = createRoot(second);
    act(() => root.render(<Title title="First" kind="docs" />));
    act(() => root2.render(<Title title="Second" kind="sheets" />));
    act(() => root.render(<Title title="First, renamed" kind="docs" />));
    expect(document.title).toBe('Second – Sheets');
    act(() => root2.render(null));
    expect(document.title).toBe('First, renamed – Docs');
    act(() => root2.unmount());
    second.remove();
  });
});
