/**
 * Driving the page's own dropdown (Listbox.tsx) from a test, as a person would: open it, then press
 * an option. The native select a test used to set with `.value` and a `change` event is not there
 * on a mouse and a keyboard, so a test that does that finds a button and fails.
 *
 * Tests only. Nothing in the app imports this.
 */

import { act } from 'react';

/** The dropdown's button, by the id a label's `for` points at, or by anything that selects it. */
export const isCombobox = (el: Element | null | undefined): boolean => el?.getAttribute('role') === 'combobox';

/** The value it shows, as `select.value` was. */
export const comboValue = (el: Element): string => el.getAttribute('data-value') ?? '';

/** The values it offers, in order. Opens it and closes it again. */
export function comboOptions(el: HTMLElement): string[] {
  act(() => el.click());
  const list = document.getElementById(el.getAttribute('aria-controls') ?? '');
  const values = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map((o) => o.dataset.value ?? '');
  act(() => el.click());
  return values;
}

/** Open the dropdown and press the option with this value. */
export function chooseCombo(el: HTMLElement, value: string): void {
  if (el.getAttribute('aria-expanded') !== 'true') act(() => el.click());
  const list = document.getElementById(el.getAttribute('aria-controls') ?? '');
  const option = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((o) => o.dataset.value === value);
  if (!option) throw new Error(`no option ${JSON.stringify(value)} in ${el.id}`);
  act(() => option.click());
}
