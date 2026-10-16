// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocKind, DocumentMeta } from '@shared/api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * One test per editor that a rename changes the tab. The editors themselves are mocked (they are
 * Tiptap, a canvas and a renderer); what is asked is what the page does with `meta.title`, and a
 * rename is what `useDocumentActions.rename` does: `setMeta({ ...meta, title })`.
 */

let first: Partial<DocumentMeta> = { kind: 'docs', id: 'd1', title: 'Minutes', locked: false };
let audience: { show: string; at: number } | null = null;

vi.mock('../router', () => ({ useRouter: () => ({ navigate: vi.fn(), path: '/', query: new URLSearchParams() }) }));
vi.mock('./useDocument', async () => {
  const react = await import('react');
  return {
    useDocument: () => {
      const [meta, setMeta] = react.useState(first as DocumentMeta);
      return { load: { status: 'ready', meta }, setMeta, refresh: vi.fn(), reload: vi.fn() };
    }
  };
});

function Rename({ meta, setMeta }: { meta: DocumentMeta; setMeta: (m: DocumentMeta) => void }) {
  const [n] = useState(0);
  return (
    <button type="button" data-n={n} onClick={() => setMeta({ ...meta, title: 'Renamed' })}>
      rename
    </button>
  );
}
vi.mock('../docs/DocsEditor', () => ({ DocsEditor: Rename }));
vi.mock('../docs/LockedView', () => ({ LockedView: () => <div data-testid="locked" /> }));
vi.mock('../sheets/SheetsEditor', () => ({ SheetsEditor: Rename }));
vi.mock('../sheets/model', () => ({ cloudSheetSource: () => ({}) }));
vi.mock('../docs/source', () => ({ cloudSource: () => ({}) }));
vi.mock('../slides/SlidesEditor', () => ({ SlidesEditor: Rename }));
vi.mock('../slides/present', () => ({
  AudienceSkeleton: () => null,
  AudienceWindow: ({ meta }: { meta: DocumentMeta }) => {
    document.title = meta.title;
    return null;
  },
  audienceParams: () => audience
}));

const { default: DocsPage } = await import('../docs/DocsPage');
const { default: SheetsPage } = await import('../sheets/SheetsPage');
const { default: SlidesPage } = await import('../slides/SlidesPage');

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.title = 'Office';
  audience = null;
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rename = () => act(() => host.querySelector<HTMLButtonElement>('button')!.click());

const cases: { name: string; kind: DocKind; page: () => React.ReactNode; title: string; tab: string }[] = [
  { name: 'Docs', kind: 'docs', page: () => <DocsPage id="d1" />, title: 'Minutes', tab: 'Minutes – Docs' },
  { name: 'Sheets', kind: 'sheets', page: () => <SheetsPage id="s1" />, title: 'Budget', tab: 'Budget – Sheets' },
  { name: 'Slides', kind: 'slides', page: () => <SlidesPage id="p1" />, title: 'Kick-off', tab: 'Kick-off – Slides' }
];

describe.each(cases)('the $name page', ({ kind, page, title, tab }) => {
  beforeEach(() => {
    first = { kind, id: `${kind}1`, title, locked: false };
  });

  it('names the tab after the document and the app', () => {
    act(() => root.render(page()));
    expect(document.title).toBe(tab);
  });

  it('follows a rename', () => {
    act(() => root.render(page()));
    rename();
    expect(document.title).toBe(`Renamed – ${tab.split(' – ')[1]}`);
  });

  it('gives the tab back to the app when the page closes', () => {
    act(() => root.render(page()));
    act(() => root.render(null));
    expect(document.title).toBe('Office');
  });
});

describe('a locked document', () => {
  it('names the tab on its password page, where the title is already shown', () => {
    first = { kind: 'docs', id: 'd1', title: 'Payroll', locked: true };
    act(() => root.render(<DocsPage id="d1" />));
    expect(host.querySelector('[data-testid="locked"]')).not.toBeNull();
    expect(document.title).toBe('Payroll – Docs');
  });
});

describe("a presentation's audience window", () => {
  it('keeps the title it sets itself', () => {
    first = { kind: 'slides', id: 'p1', title: 'Kick-off', locked: false };
    audience = { show: 'x', at: 0 };
    act(() => root.render(<SlidesPage id="p1" />));
    expect(document.title).toBe('Kick-off');
  });
});
