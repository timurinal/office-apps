/**
 * Whether this page is in the desktop app (`Programs/office`), by its user agent, which the shell
 * marks with ` OfficeCompanion/<version>` (docs/desktop-bridge.md, "Finding it").
 *
 * The one part of the bridge every page loads at once: a test of one string. Everything else is in
 * `bridge.ts`, which a page loads only when this says yes.
 */

const MARK = 'OfficeCompanion/';

export const isDesktopUA = (ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean => ua.includes(MARK);
