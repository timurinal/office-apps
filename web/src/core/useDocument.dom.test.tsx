// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishTitle } from './titles';
import { useDocument, type DocLoad } from './useDocument';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let seen: DocLoad;

function Probe({ id }: { id: string }) {
  seen = useDocument(id).load;
  return null;
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ id: 'doc_a', title: 'Alpha', kind: 'docs' }), { status: 200 })
  );
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const title = () => (seen.status === 'ready' ? seen.meta.title : null);

describe('useDocument and a rename made elsewhere', () => {
  it('takes the new title the room announces for this document, and only for this one', async () => {
    await act(async () => root.render(<Probe id="doc_a" />));
    expect(title()).toBe('Alpha');

    act(() => publishTitle('doc_b', 'Someone else’s'));
    expect(title()).toBe('Alpha');

    act(() => publishTitle('doc_a', 'Q3 plan'));
    expect(title()).toBe('Q3 plan');
  });

  it('stops listening once the page has gone', async () => {
    await act(async () => root.render(<Probe id="doc_a" />));
    act(() => root.render(<></>));
    act(() => publishTitle('doc_a', 'Later'));
    expect(title()).toBe('Alpha');
  });
});
