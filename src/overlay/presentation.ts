/**
 * Map a device to how a component presents its floating layer (SPEC §12.9).
 *
 * The concern is split in two on purpose:
 *   - {@link classifyDevice} (in `../environment`) owns the shared *classification*
 *     (`mobile`/`tablet`/`desktop`) — the fact every KM component must agree on.
 *   - {@link resolvePresentation} here owns the *policy* — which presentation each
 *     class gets — because that legitimately differs per component (a multiselect
 *     wants a floating panel on a tablet; a calendar may want a centered modal).
 *
 * Pure functions (no DOM, no element): a component's `environmentChanged()` hook
 * feeds them the current {@link EnvironmentSnapshot} and relays the result to its
 * view. Note the size boundary is capability-gated, so a *narrowed desktop window*
 * stays `desktop` → `floating` (never fullscreen) — see {@link classifyDevice}.
 */
import { classifyDevice, type DeviceClass, type EnvironmentSnapshot } from '../environment/environment.js';

// Re-exported so the 600px boundary constant keeps its historical import path.
export { TABLET_MIN_SHORT_SIDE } from '../environment/environment.js';

/** The author-facing `mobile-presentation` attribute values (`auto` = decide from the device). */
export type MobilePresentation = 'auto' | 'floating' | 'modal' | 'fullscreen';

/** A concrete presentation a component renders (what its `setPresentation()` accepts). */
export type ResolvedPresentation = 'floating' | 'modal' | 'fullscreen';

/** Per-class presentation overrides; unspecified classes fall back to {@link DEFAULT_PRESENTATION_MAP}. */
export type PresentationMap = Partial<Record<DeviceClass, ResolvedPresentation>>;

/**
 * The default class→presentation policy: fullscreen on a phone, floating panel
 * everywhere else. This is what every overlay component does today, so it's the
 * default — a component that differs (e.g. a tablet modal) passes overrides to
 * {@link resolvePresentation} rather than re-deriving the whole map.
 */
export const DEFAULT_PRESENTATION_MAP: Readonly<Record<DeviceClass, ResolvedPresentation>> = {
  mobile: 'fullscreen',
  tablet: 'floating',
  desktop: 'floating',
};

/**
 * Resolve a `mobile-presentation` setting + the current environment to a concrete
 * presentation. A forced mode (`floating`/`modal`/`fullscreen`) is returned as-is
 * (handy for previews/testing on any device); `auto` classifies the device
 * ({@link classifyDevice}) and looks it up in `map`, falling back per-class to
 * {@link DEFAULT_PRESENTATION_MAP}. Pass only the classes you want to override —
 * e.g. `{ tablet: 'modal' }` keeps the default phone/desktop behavior and only
 * changes the tablet.
 */
export function resolvePresentation(
  mode: MobilePresentation,
  env: EnvironmentSnapshot,
  map: PresentationMap = {},
): ResolvedPresentation {
  if (mode !== 'auto') return mode;
  const cls = classifyDevice(env);
  return map[cls] ?? DEFAULT_PRESENTATION_MAP[cls];
}

/**
 * The presentation flags a component surfaces into its render-callback context, so a
 * custom renderer can adapt content to how the panel is currently shown — e.g. rich rows
 * on the desktop floating panel and a leaner variant in the phone fullscreen sheet. Built
 * from the {@link ResolvedPresentation} a component is rendering in (its `setPresentation`
 * value); spread into the per-item context handed to the consumer's callback.
 */
export interface PresentationContext {
  /** The concrete presentation the panel is rendering in. */
  presentation: ResolvedPresentation;
  /** Convenience for `presentation === 'fullscreen'` (the phone overlay sheet). */
  isFullscreen: boolean;
  /** Convenience for `presentation === 'modal'` (a centered modal, for components that use it). */
  isModal: boolean;
}

/**
 * Build the {@link PresentationContext} flags from a resolved presentation. A tiny shared
 * helper so every KM component surfaces the same shape into its render callbacks instead of
 * re-deriving the booleans. Reactive by construction: call it wherever you build the render
 * context and it reflects the component's current presentation.
 */
export function presentationContext(presentation: ResolvedPresentation): PresentationContext {
  return {
    presentation,
    isFullscreen: presentation === 'fullscreen',
    isModal: presentation === 'modal',
  };
}

/**
 * @deprecated since 1.0.0-rc07 — use {@link resolvePresentation} (with
 * {@link classifyDevice}). This binary form is kept for the rc06 consumers and
 * will be removed at 1.0. Equivalent to `resolvePresentation` with the default
 * map: fullscreen on a phone, floating otherwise; it never returns `modal`.
 */
export function resolveMobilePresentation(
  mode: 'auto' | 'floating' | 'fullscreen',
  env: EnvironmentSnapshot,
): 'floating' | 'fullscreen' {
  return resolvePresentation(mode, env) as 'floating' | 'fullscreen';
}
