import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Host } from './host';
import { guardFor } from './guard';

function host() {
  return { openExternal: vi.fn(), showStart: vi.fn() } as unknown as Host & { openExternal: ReturnType<typeof vi.fn>; showStart: ReturnType<typeof vi.fn> };
}

describe('the navigation guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every window on its document', () => {
    vi.stubGlobal('window', { location: { protocol: 'app:', host: 'local', pathname: '/docs' } });
    const h = host();
    const guard = guardFor(h);
    expect(guard(new URL('app://local/'))).toBe(true);
    expect(h.showStart).toHaveBeenCalledOnce();
    expect(guard(new URL('app://local/docs/doc_123'))).toBe(true);
    expect(guard(new URL('https://example.com/a'))).toBe(true);
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com/a');
    expect(guard(new URL('javascript:alert(1)'))).toBe(true);
    expect(h.openExternal).toHaveBeenCalledOnce();
  });
});
