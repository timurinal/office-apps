/** Keyboard hints, written for the platform the reader is on. */

export const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

/** `mod('B')` is `⌘B` on a Mac and `Ctrl+B` elsewhere; `mod('Shift+Z')` follows. */
export const mod = (keys: string): string => (isMac() ? `⌘${keys.replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥')}` : `Ctrl+${keys}`);
