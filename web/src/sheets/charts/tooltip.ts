/**
 * The readout that follows a pointer over a chart: a title and a row per series, the value first.
 *
 * It is built with the DOM and `textContent`, never from markup, because a series' name and a
 * category's label are whatever a cell holds. It is moved with a transform from pointer events and
 * is never animated: nothing moves under a pointer on a schedule of its own.
 */

import type { Tip } from './layout';

export class ChartTip {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'oac-tip';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** `x` and `y` are inside the parent, in its own pixels. */
  show(tip: Tip, x: number, y: number, bounds: { w: number; h: number }): void {
    const el = this.el;
    el.replaceChildren();
    if (tip.title) {
      const t = document.createElement('div');
      t.className = 'oac-tip-title';
      t.textContent = tip.title;
      el.appendChild(t);
    }
    for (const r of tip.rows) {
      const row = document.createElement('div');
      row.className = 'oac-tip-row';
      if (r.color) {
        const key = document.createElement('span');
        key.className = 'oac-tip-key';
        key.style.background = r.color;
        row.appendChild(key);
      }
      const value = document.createElement('strong');
      value.textContent = r.value;
      const name = document.createElement('span');
      name.textContent = r.name;
      row.appendChild(value);
      row.appendChild(name);
      el.appendChild(row);
    }
    el.hidden = false;
    // Beside the pointer, and back inside the card where it would run off.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + 14 + w > bounds.w ? Math.max(0, x - 14 - w) : x + 14;
    const top = Math.max(0, Math.min(bounds.h - h, y - h / 2));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  destroy(): void {
    this.el.remove();
  }
}
