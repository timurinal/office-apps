// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { landing, viewTransition } from './viewTransition';

afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.motion;
  document.documentElement.classList.remove('oa-vt');
  vi.unstubAllGlobals();
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  vi.useRealTimers();
});

const paper = (cls: string): HTMLElement => {
  const el = document.createElement('div');
  el.className = cls;
  el.dataset.docPage = 'true';
  return el;
};
const find = () => document.querySelector<HTMLElement>('[data-doc-page]');
const stays = (el: HTMLElement) => el.classList.contains('oa-paper');

describe('the landing element of a morph', () => {
  it('is the first one found when nobody asked to wait', async () => {
    document.body.appendChild(paper('oa-skel-paper'));
    expect((await landing({ to: find, stays }))?.className).toBe('oa-skel-paper');
    expect((await landing({ to: find, stays, settleMs: 0 }))?.className).toBe('oa-skel-paper');
  });

  it('is at once the one that stays, when it is already there', async () => {
    document.body.appendChild(paper('oa-paper'));
    expect((await landing({ to: find, stays, settleMs: 500 }))?.className).toBe('oa-paper');
  });

  it('waits for the real page when a placeholder is drawn first, and lands on the real one', async () => {
    const skeleton = paper('oa-skel-paper');
    document.body.appendChild(skeleton);
    const result = landing({ to: find, stays, settleMs: 500 });
    // A few milliseconds on, React swaps the skeleton for the page.
    setTimeout(() => {
      skeleton.remove();
      document.body.appendChild(paper('oa-paper'));
    }, 10);
    expect((await result)?.className).toBe('oa-paper');
  });

  it('gives up after settleMs and lands on the best there is', async () => {
    vi.useFakeTimers();
    document.body.appendChild(paper('oa-skel-paper'));
    const result = landing({ to: find, stays, settleMs: 150 });
    await vi.advanceTimersByTimeAsync(151);
    expect((await result)?.className).toBe('oa-skel-paper');
  });

  it('is nothing when there is nothing, and does not wait forever for it', async () => {
    vi.useFakeTimers();
    const result = landing({ to: find, stays, settleMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBeNull();
  });
});

describe('a transition', () => {
  /** A browser's startViewTransition: runs the callback, then captures the names it can see. */
  const browser = () => {
    const captured: { named: string[] } = { named: [] };
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => Promise<void>) => ({
      finished: Promise.resolve(cb()).then(() => {
        captured.named = [...document.querySelectorAll<HTMLElement>('[data-doc-page]')]
          .filter((el) => el.style.getPropertyValue('view-transition-name') === 'oa-morph')
          .map((el) => el.className);
      })
    });
    return captured;
  };

  it('names the real page, not the skeleton that is replaced under it', async () => {
    const captured = browser();
    const card = document.createElement('div');
    document.body.appendChild(card);
    const skeleton = paper('oa-skel-paper');
    await viewTransition(
      () => {
        document.body.appendChild(skeleton);
        setTimeout(() => {
          skeleton.remove();
          document.body.appendChild(paper('oa-paper'));
        }, 5);
      },
      { from: card, to: find, stays, settleMs: 300 }
    );
    expect(captured.named).toEqual(['oa-paper']);
    // And the names are gone again afterwards: a name must be unique on the page.
    expect(card.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.querySelector<HTMLElement>('.oa-paper')?.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('names the skeleton when the page is not coming (no waiting asked for)', async () => {
    const captured = browser();
    await viewTransition(() => void document.body.appendChild(paper('oa-skel-paper')), { to: find, stays, settleMs: 0 });
    expect(captured.named).toEqual(['oa-skel-paper']);
  });

  it('runs the update and nothing else where there are no view transitions', async () => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    const update = vi.fn();
    await viewTransition(update, { from: document.body });
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('oa-vt')).toBe(false);
  });
});
