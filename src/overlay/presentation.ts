/**
 * Resolve a component's `mobile-presentation` setting against the live
 * device/viewport environment (SPEC §12.9) into a concrete presentation mode.
 *
 * A pure function (no DOM, no element) so the phone/tablet/desktop mapping is
 * unit-testable in isolation: a component's `environmentChanged()` hook feeds it
 * the current {@link EnvironmentSnapshot} and relays the result to its view. The
 * policy lives here — not in each component — so every KM component agrees on
 * what "a phone" is (a multiselect and a daterangepicker must not disagree).
 */
import type { EnvironmentSnapshot } from '../environment/environment.js';

/** The author-facing `mobile-presentation` attribute values. */
export type MobilePresentation = 'auto' | 'floating' | 'fullscreen';

/** The concrete presentation a component renders (what its `setPresentation()` accepts). */
export type ResolvedPresentation = 'floating' | 'fullscreen';

/**
 * The phone/tablet boundary, in **CSS px** (not inches), applied to the *shorter*
 * viewport side. This is the Material `sw600dp` line — "smallest width ≥ 600dp ⇒
 * tablet" — and it's the orientation-robust test we want: a device's shorter side
 * stays constant across rotation, so a phone reads as a phone in landscape too.
 *
 * Why 600, against the 2026 CSS-width map (physical ÷ DPR, what media queries see —
 * inches lie): phones lay out at ~320–360 (compact), ~390–393 (mainstream), and up
 * to ~430 CSS px, with ~480 as the large-phone/Pro-Max stress point. 7" tablets
 * start ~600, iPad mini ~768, and folds *open* jump to ~700+. So 480→600 is an
 * empty band with no phones in it — `< 600` catches every phone (comfortable
 * headroom over ~480) while handing tablets and opened foldables to the floating
 * panel. Single knob: bump this if the device landscape shifts.
 */
export const TABLET_MIN_SHORT_SIDE = 600;

/**
 * Map a `mobile-presentation` setting + the current environment to a concrete
 * presentation. `floating` / `fullscreen` are forced (the latter is handy for
 * previews/testing on any device); `auto` is the reactive rule: a phone is a
 * touch-primary device whose *shorter* viewport side is below the tablet boundary
 * (orientation-robust). Everything else keeps the floating panel.
 */
export function resolveMobilePresentation(
  mode: MobilePresentation,
  env: EnvironmentSnapshot,
): ResolvedPresentation {
  if (mode === 'floating') return 'floating';
  if (mode === 'fullscreen') return 'fullscreen';
  const shortSide = Math.min(env.viewportWidth, env.viewportHeight);
  return env.isTouchPrimary && shortSide < TABLET_MIN_SHORT_SIDE ? 'fullscreen' : 'floating';
}
