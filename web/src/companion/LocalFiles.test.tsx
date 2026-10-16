// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToastHost } from '../core/ui';
import { localClient } from './bridge';
import { LocalFiles } from './LocalFiles';
import { NEVER, fakeHost } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recent = (over: Record<string, unknown> = {}) => ({ key: 'k1', name: 'Budget.xlsx', folder: '~/Documents/Finance', format: 'xlsx', modified: Date.now() - 3 * 3600_000, ...over });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-toast, [role="menu"]').forEach((n) => n.remove());
});

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function draw(answers: Record<string, unknown>) {
  const fake = fakeHost(answers);
  act(() =>
    root.render(
      <ToastHost>
        <LocalFiles client={localClient(fake.raw)!} />
      </ToastHost>
    )
  );
  await flush();
  return fake;
}

const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);

describe('On this PC', () => {
  it('is an outline while the list comes, and never a spinner', async () => {
    await draw({ recentFiles: NEVER });
    expect(host.querySelector('h2')?.textContent).toBe('On this PC');
    expect(host.querySelector('.oa-skel-rows')).not.toBeNull();
    expect(host.textContent).not.toContain('Loading');
  });

  it('lists the recent files with their folders, newest first as the shell gives them', async () => {
    await draw({ recentFiles: JSON.stringify([recent(), recent({ key: 'k2', name: 'Letter.docx', format: 'docx', folder: '~/Letters' })]) });
    const rows = [...host.querySelectorAll('[role="listitem"]')];
    expect(rows.map((r) => r.querySelector('button')?.textContent)).toEqual(['Budget.xlsx', 'Letter.docx']);
    expect(rows[0]!.textContent).toContain('~/Documents/Finance');
    expect(rows[0]!.textContent).toContain('3 hours ago');
    expect(rows.map((r) => r.getAttribute('data-app'))).toEqual(['sheets', 'docs']);
  });

  it('says there are none, and offers what to do', async () => {
    await draw({ recentFiles: '[]' });
    expect(host.textContent).toContain('No recent files.');
    expect(button('Open')).toBeDefined();
  });

  it('opens a recent file in the app', async () => {
    const fake = await draw({ recentFiles: JSON.stringify([recent()]), openRecent: '' });
    act(() => button('Budget.xlsx')!.click());
    await flush();
    expect(fake.of('openRecent')).toEqual([['k1']]);
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(1);
  });

  it('drops a file that has gone, and says so', async () => {
    await draw({ recentFiles: JSON.stringify([recent()]), openRecent: 'missing' });
    act(() => button('Budget.xlsx')!.click());
    await flush();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(0);
    expect(document.body.querySelector('.oa-toast')?.textContent).toContain('Budget.xlsx');
  });

  it('opens the native dialog, and makes a new file of each kind', async () => {
    const fake = await draw({ recentFiles: '[]' });
    act(() => button('Open')!.click());
    expect(fake.of('openFile')).toEqual([[]]);
    for (const [label, kind] of [
      ['New document', 'docs'],
      ['New spreadsheet', 'sheets'],
      ['New presentation', 'slides']
    ] as const) {
      act(() => button('New')!.click());
      act(() => button(label)!.click());
      expect(fake.of('newLocal').at(-1)).toEqual([kind]);
    }
  });

  it('asks again when the tab is shown again', async () => {
    const fake = await draw({ recentFiles: '[]' });
    expect(fake.of('recentFiles')).toHaveLength(1);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(fake.of('recentFiles')).toHaveLength(2);
  });
});
