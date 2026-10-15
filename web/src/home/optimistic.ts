/**
 * Every action answers in the same frame.
 *
 * Star, rename, trash and a role change change the screen first and ask the server
 * second; if the server refuses, the screen goes back and says why. This is that
 * pattern once, so a new action does not re-derive the order of the three steps.
 *
 *   await optimistic({
 *     apply: () => patch(id, { starred: true }),     // the screen, now
 *     commit: () => documents.star(id, true),         // the server
 *     rollback: () => patch(id, { starred: false }),  // the screen, back
 *     onError: (err) => notify(...)
 *   });
 *
 * `apply` runs before `commit` starts and `rollback` only if `commit` throws. It
 * resolves true when the server agreed.
 */

export async function optimistic({
  apply,
  commit,
  rollback,
  onError
}: {
  apply: () => void;
  commit: () => Promise<unknown>;
  rollback: () => void;
  onError?: (err: unknown) => void;
}): Promise<boolean> {
  apply();
  try {
    await commit();
    return true;
  } catch (err) {
    rollback();
    onError?.(err);
    return false;
  }
}
