/**
 * A very small History-API router.
 *
 * The design prototype had no URLs at all — it switched on a `page` field in
 * component state, so nothing was linkable, shareable or reloadable. Production
 * needs real paths, but not a routing library: the site has a fixed, shallow
 * set of routes and no nested layouts, so this is about forty lines instead of
 * a dependency.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface RouterValue {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/** Called with every URL `navigate` is given; true means it was handled and the router does nothing. */
let guard: ((url: URL) => boolean) | null = null;
export function setNavigationGuard(next: ((url: URL) => boolean) | null): void {
  guard = next;
}

/** `navigate` replaces the History API's: the desktop app's local page has no other address to go to. */
export function RouterProvider({ children, navigate: replaced }: { children: React.ReactNode; navigate?: RouterValue['navigate'] }) {
  const [path, setPath] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    // Back/forward buttons.
    const onPop = () => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (guard?.(url)) return;
    // An external link should leave the SPA rather than being pushed onto our
    // own history stack.
    if (url.origin !== window.location.origin) {
      window.location.href = to;
      return;
    }

    if (opts?.replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);

    setPath(url.pathname);
    setSearch(url.search);
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ path, query: new URLSearchParams(search), navigate: replaced ?? navigate }),
    [path, search, navigate, replaced]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter used outside RouterProvider');
  return ctx;
}

/** Anchor that stays inside the SPA, while remaining a real link for
 *  middle-click, ctrl-click and assistive tech. */
export function Link({
  to,
  children,
  style,
  className,
  onClick
}: {
  to: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();

  return (
    <a
      href={to}
      className={className}
      style={{ textDecoration: 'none', color: 'inherit', ...style }}
      onClick={(e) => {
        // Let the browser handle modified clicks so "open in new tab" works.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Match `/apps/:key` style patterns. Returns params, or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i]!);
    else if (seg !== a[i]) return null;
  }
  return params;
}
