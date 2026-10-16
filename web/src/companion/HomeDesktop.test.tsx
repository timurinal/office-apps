// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../core/ui';
import { RouterProvider } from '../router';
import { cloudClient, type CloudClient } from './bridge';
import { fakeHost } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Home inside the app: the files on this computer, and a file Upload to Office left for it. */

const m = vi.hoisted(() => ({ bridge: vi.fn(), take: vi.fn() }));
vi.mock('./cloud', () => ({ cloudBridge: m.bridge, takeImportFile: m.take }));

const { default: HomeDesktop } = await import('./HomeDesktop');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  m.bridge.mockReset();
  m.take.mockReset();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-toast').forEach((n) => n.remove());
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function draw({ client = null, showFiles = true }: { client?: CloudClient | null | Promise<never>; showFiles?: boolean } = {}) {
  m.bridge.mockReturnValue(client instanceof Promise ? client : Promise.resolve(client));
  const navigate = vi.fn();
  const takeFiles = vi.fn();
  act(() =>
    root.render(
      <RouterProvider navigate={navigate}>
        <ToastHost>
          <HomeDesktop takeFiles={takeFiles} showFiles={showFiles} />
        </ToastHost>
      </RouterProvider>
    )
  );
  await flush();
  return { navigate, takeFiles };
}

const client = () => cloudClient(fakeHost({ recentFiles: JSON.stringify([{ key: 'k', name: 'Budget.xlsx', folder: '~', format: 'xlsx', modified: Date.now() }]) }).raw)!;

describe('On this PC, on Home', () => {
  it('is an outline until the shell answers', async () => {
    await draw({ client: new Promise<never>(() => undefined) });
    expect(host.querySelector('h2')?.textContent).toBe('On this PC');
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lists the recent files once it does', async () => {
    await draw({ client: client() });
    await flush();
    expect(host.textContent).toContain('Budget.xlsx');
  });

  it('is not there when the shell never came, nor in another view', async () => {
    await draw({ client: null });
    expect(host.textContent).toBe('');
    await draw({ client: client(), showFiles: false });
    expect(host.textContent).toBe('');
  });
});

describe('a file Upload to Office left', () => {
  it('is imported as a dropped file is, and the address forgets it', async () => {
    window.history.replaceState({}, '', '/?import=n0nce');
    const file = new File([new Uint8Array([1])], 'Budget.xlsx');
    m.take.mockResolvedValue(file);
    const { navigate, takeFiles } = await draw({ showFiles: false });
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(m.take).toHaveBeenCalledWith('n0nce');
    expect(takeFiles).toHaveBeenCalledWith([file]);
  });

  it('says so when it is gone', async () => {
    window.history.replaceState({}, '', '/?import=old');
    m.take.mockResolvedValue(null);
    const { takeFiles } = await draw();
    expect(takeFiles).not.toHaveBeenCalled();
    expect(document.body.querySelector('.oa-toast')?.textContent).toBe('That upload expired. Upload it again.');
  });

  it('is asked for once, though React asks twice', async () => {
    window.history.replaceState({}, '', '/?import=twice');
    m.take.mockResolvedValue('asked');
    const { takeFiles } = await draw();
    expect(takeFiles).not.toHaveBeenCalled();
    expect(document.body.querySelector('.oa-toast')).toBeNull();
  });

  it('is not asked for without a nonce', async () => {
    await draw();
    expect(m.take).not.toHaveBeenCalled();
  });
});
