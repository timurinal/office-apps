// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkLanding as Landing } from '@shared/api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ landing: vi.fn(), unlock: vi.fn(), navigate: vi.fn() }));
vi.mock('../client', () => ({ links: { landing: m.landing, unlock: m.unlock } }));
vi.mock('../router', () => ({
  useRouter: () => ({ navigate: m.navigate, path: '/l/t', query: new URLSearchParams() }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>
}));

const { LinkLanding } = await import('./LinkLanding');

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.title = 'Office';
  m.landing.mockReset();
  m.navigate.mockReset();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const open = async (answer: Landing) => {
  m.landing.mockResolvedValue(answer);
  await act(async () => root.render(<LinkLanding token="t" />));
  await act(async () => void (await Promise.resolve()));
};

describe('the page a link opens', () => {
  it('names the tab after the document as soon as the link has answered', async () => {
    await open({ status: 'ok', documentId: 'p1', kind: 'slides', title: 'Roadmap', role: 'viewer', allowDownload: false });
    expect(m.navigate).toHaveBeenCalledWith('/slides/p1', { replace: true });
    expect(document.title).toBe('Roadmap – Slides');
  });

  it('says nothing about a document behind a password, or one that is gone', async () => {
    await open({ status: 'password' });
    expect(document.title).toBe('Office');
    act(() => root.render(null));
    await open({ status: 'gone' });
    expect(document.title).toBe('Office');
  });
});
