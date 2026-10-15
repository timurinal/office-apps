// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelOf, testDeck } from './model/testing';
import type { SlideModel } from './model/model';
import { useSlide } from './useSlideModel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const deck = (): SlideModel =>
  modelOf(
    testDeck([
      { id: 's1', layout: 'blank', elements: [] },
      { id: 's2', layout: 'blank', elements: [] }
    ])
  );

describe('one slide of the model', () => {
  it('follows the id it is given, with no change to the deck between', () => {
    const m = deck();
    const seen = vi.fn();
    function Probe({ id }: { id: string }) {
      seen(useSlide(m, id)?.id ?? null);
      return null;
    }
    act(() => root.render(<Probe id="s1" />));
    expect(seen).toHaveBeenLastCalledWith('s1');
    // The rail picks another slide: the selection changed, the deck did not.
    act(() => root.render(<Probe id="s2" />));
    expect(seen).toHaveBeenLastCalledWith('s2');
    m.destroy();
  });

  it('draws the slide the selection moved to after the shown one was taken away', () => {
    // A new slide undone: the change removes the shown slide, and the selection then moves.
    const m = deck();
    const seen = vi.fn();
    function Probe({ id }: { id: string }) {
      seen(useSlide(m, id)?.id ?? null);
      return null;
    }
    act(() => root.render(<Probe id="s2" />));
    act(() => {
      m.deleteSlides(['s2']);
    });
    expect(seen).toHaveBeenLastCalledWith(null);
    act(() => root.render(<Probe id="s1" />));
    expect(seen).toHaveBeenLastCalledWith('s1');
    m.destroy();
  });
});
