/**
 * Lock page scroll behind a fullscreen overlay (SPEC §12.9). A single
 * ref-counted lock over `document.body`'s `overflow`: the first lock stashes the
 * prior value and sets `hidden`; the last release restores it. Ref-counting makes
 * it safe when several overlays (or several component instances) are open at once
 * — page scroll stays locked until the *last* one closes, and the original
 * `overflow` is never clobbered by a nested lock.
 *
 * SSR-safe: with no `document` it's a no-op returning a no-op release.
 */

/** How many active locks are holding page scroll shut. */
let lockCount = 0;
/** The body `overflow` captured on the 0→1 transition, restored on 1→0 (null when unlocked). */
let stashedOverflow: string | null = null;

/**
 * Lock `document.body` scroll and return a release function. Idempotent per call:
 * the returned release runs at most once, so a double-release can't unbalance the
 * ref count. Restores the original `overflow` only when the final lock releases.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  if (lockCount === 0) {
    stashedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && stashedOverflow !== null) {
      document.body.style.overflow = stashedOverflow;
      stashedOverflow = null;
    }
  };
}

/** Test-only: force-release all locks and restore the body immediately. */
export function __resetScrollLock(): void {
  if (typeof document !== 'undefined' && stashedOverflow !== null) {
    document.body.style.overflow = stashedOverflow;
  }
  lockCount = 0;
  stashedOverflow = null;
}
