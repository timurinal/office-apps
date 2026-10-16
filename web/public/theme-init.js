/*
 * Settles the theme before the first paint, so a reader on Dark never sees a white frame.
 *
 * It is the same decision as `resolveTheme` in web/src/core/appearance.ts, and
 * appearance.test.ts runs this file against that function for every case. A file and not an
 * inline script: the policy is `script-src 'self'` (worker/lib/headers.ts). Classic and blocking
 * on purpose; it is a few lines, and index.html loads it before the stylesheet.
 */
(function () {
  var appearance = 'system';
  try {
    var kept = localStorage.getItem('office.appearance');
    if (kept === 'light' || kept === 'dark') appearance = kept;
  } catch (e) {
    // Blocked site data: System.
  }
  var dark = appearance === 'dark';
  if (appearance === 'system') {
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      // No matchMedia: light.
    }
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-appearance', appearance);
})();
