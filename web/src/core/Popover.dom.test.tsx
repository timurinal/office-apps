// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './ui';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1440);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** The panel's margin when the browser would draw it from `left` to `right`. */
function marginAt(left: number, right: number): string {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // Where it lands once moved, as the browser would report it after the margin.
    const by = parseFloat(this.style.marginLeft) || 0;
    return { left: left + by, right: right + by, x: left + by, y: 0, top: 0, bottom: 100, width: right - left, height: 100, toJSON: () => ({}) } as DOMRect;
  });
  act(() =>
    root.render(
      <Popover open onClose={() => undefined} role="menu">
        <button type="button">Align left</button>
      </Popover>
    )
  );
  return host.querySelector<HTMLElement>('.oa-popover')!.style.marginLeft;
}

describe('a popover near the side of the window', () => {
  it('moves in from the right edge, keeping 8 px', () => {
    expect(marginAt(1300, 1457)).toBe('-25px');
  });

  it('moves in from the left edge', () => {
    expect(marginAt(-20, 180)).toBe('28px');
  });

  it('stays where it is when it fits', () => {
    expect(marginAt(400, 600)).toBe('');
  });
});
