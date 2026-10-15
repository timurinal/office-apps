/**
 * Where things live, and how times are written.
 *
 * What used to be here (the chrome's metrics, the radii, the motion durations and the
 * type helpers) is `styles.css`, `motion/index.ts` and the components themselves now:
 * the design is CSS, with `var(--*)` tokens, and the numbers are written once there.
 */

// ── origins ─────────────────────────────────────────────────────────────────

/**
 * Where the account lives.
 *
 * Copied from another app's `accountOrigin()`, localhost arm included: main runs on
 * :8787 in development and a hardcoded production origin would make the
 * sign-in round trip impossible to exercise locally.
 */
export function accountOrigin(): string {
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:8787`;
  // The staging mirror signs in on its own domain.
  return hostname.endsWith('.example.org') ? 'https://example.org' : 'https://example.com';
}

/** Round-trips through the main site, which owns sessions. It lands back here
 *  because `office.example.com` is in `RETURN_HOSTS` in the account site's
 *  shared/returnto.ts — without that entry this ends on /account instead. */
export const signInHref = (returnTo: string): string =>
  `${accountOrigin()}/signin?next=${encodeURIComponent(returnTo)}`;

/** Where Help goes. One constant, so moving the documentation is a one-line change. */
export const HELP_URL = 'https://docs.example.com';

// ── formatting ──────────────────────────────────────────────────────────────

/**
 * Relative for the last week, then an absolute short date.
 *
 * Copied from the sibling apps' theme.ts rather than imported, because the web
 * apps share no package. If you change one, change the others.
 */
export function formatWhen(unixSeconds: number): string {
  const then = new Date(unixSeconds * 1000);
  const diff = Date.now() / 1000 - unixSeconds;

  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diff < 172800) return 'yesterday';
  if (diff < 604800) return then.toLocaleDateString('en-GB', { weekday: 'long' });
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
