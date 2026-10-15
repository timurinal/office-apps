/**
 * Where the editors would navigate, and what the desktop does instead.
 *
 * The editors were written for a site: the header's badge goes to `/`, a document link goes to
 * `/docs/<id>`. In the app a window keeps the document it opened with, so the router hands every
 * URL here first (`setNavigationGuard`), and nothing reaches the address bar.
 */

import { setNavigationGuard } from '../router';
import type { Host } from './host';

export function guardFor(host: Host): (url: URL) => boolean {
  return (url) => {
    // Not `origin`: a custom scheme's is "null" wherever the scheme is not registered as standard.
    if (url.protocol !== window.location.protocol || url.host !== window.location.host) {
      if (/^(https?|mailto):$/.test(url.protocol)) host.openExternal(url.href);
      return true;
    }
    if (url.pathname === '/' && window.location.pathname !== '/') host.showStart();
    return true;
  };
}

export function installGuard(host: Host): void {
  setNavigationGuard(guardFor(host));
}
