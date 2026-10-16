/**
 * The colours a portalled panel wears.
 *
 * The app's colour (`data-app`) and the theme (`data-theme`) are set on an editor's root, so a panel
 * that is portalled to `<body>` loses both. It copies them from the element it came from, or, for a
 * menu opened at a point, from the editor's shell. Reading the attributes rather than deciding from
 * the app's kind means that a theme set anywhere above the trigger (the shell, a dialog's scrim)
 * reaches the panel, whatever put it there.
 */

export interface Scope {
  'data-app'?: string;
  'data-theme'?: string;
}

/** The attributes of `from`'s nearest ancestors that carry the app and the theme. */
export function scopeOf(from: Element | null | undefined): Scope {
  const base = from ?? (typeof document === 'undefined' ? null : document.querySelector('.oa-shell'));
  const app = base?.closest('[data-app]')?.getAttribute('data-app');
  const theme = base?.closest('[data-theme]')?.getAttribute('data-theme');
  return { ...(app ? { 'data-app': app } : {}), ...(theme ? { 'data-theme': theme } : {}) };
}

/**
 * Whether a press landed in a dropdown's list or a menu: panels drawn in a portal on <body>, outside the
 * element that owns them. A panel that closes on a press "outside" itself (a popover, the filter menu)
 * must not count these as outside, or choosing an option would close the panel that holds the dropdown
 * before the option is chosen.
 */
export const inPortalledPopup = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.oa-ctx-root') !== null;
