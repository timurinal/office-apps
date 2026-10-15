import { describe, expect, it, vi } from 'vitest';
import { optimistic } from './optimistic';

describe('an optimistic action', () => {
  it('changes the screen before the server has answered', async () => {
    const order: string[] = [];
    let release!: () => void;
    const pending = optimistic({
      apply: () => order.push('apply'),
      commit: () =>
        new Promise<void>((r) => {
          order.push('commit');
          release = r;
        }),
      rollback: () => order.push('rollback')
    });
    expect(order).toEqual(['apply', 'commit']);
    release();
    expect(await pending).toBe(true);
    expect(order).toEqual(['apply', 'commit']);
  });

  it('puts the screen back, and says why, when the server refuses', async () => {
    const order: string[] = [];
    const err = new Error('no');
    const onError = vi.fn(() => order.push('error'));
    const ok = await optimistic({
      apply: () => order.push('apply'),
      commit: () => Promise.reject(err),
      rollback: () => order.push('rollback'),
      onError
    });
    expect(ok).toBe(false);
    expect(order).toEqual(['apply', 'rollback', 'error']);
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('is fine without an error handler', async () => {
    await expect(optimistic({ apply: () => undefined, commit: () => Promise.reject(new Error('x')), rollback: () => undefined })).resolves.toBe(false);
  });
});
