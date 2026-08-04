/**
 * Shared types for the positioning module (SPEC §12.2). One low-level
 * {@link AnchorOptions} primitive plus the two preset option/handle shapes.
 * Re-exports the `@floating-ui/dom` types a caller needs so components import
 * them from core (one pinned version) instead of the raw package (which drifted
 * across 1.5/1.7 in the five shipping components).
 */
import type { Placement, Strategy, Platform, VirtualElement } from '@floating-ui/dom';
import type { DriftReport } from './containing-block.js';

export type { Placement, Strategy, Platform, VirtualElement };

/** How to size the floating element against its reference (via floating-ui `size()`). */
export type MatchWidth = 'min' | 'exact' | false;

/** Options for the low-level {@link anchor} primitive. */
export interface AnchorOptions {
  /** Preferred placement. Default `'bottom-start'`. */
  placement?: Placement;
  /** Positioning strategy. Default `'fixed'` (portal-friendly, avoids ancestor clipping). */
  strategy?: Strategy;
  /** Gap between reference and floating, in px. Default `4`. */
  offset?: number;
  /** Allow flipping to the opposite side on overflow. Default `true`. */
  flip?: boolean;
  /** Shift padding in px to stay in view, or `false` to disable. Default `8`. */
  shift?: number | false;
  /** Match the reference's width: `'min'` (min-width), `'exact'` (width), or `false`. Default `false`. */
  matchWidth?: MatchWidth;
  /**
   * Keep the placement stable instead of re-flipping every frame. Requires `flip`.
   * - `true` — flip returns to the initial placement rather than reordering
   *   (floating-ui `fallbackStrategy: 'initialPlacement'`).
   * - `'freeze'` — flip once on the FIRST computation, then pin the resolved
   *   placement and stop flipping (the "open where it fits, then don't jump as
   *   the user scrolls" behaviour a dropdown wants).
   *
   * Default `false`.
   */
  lockPlacement?: boolean | 'freeze';
  /** Keep the position updated on scroll/resize via floating-ui `autoUpdate`. Default `true`. */
  autoUpdate?: boolean;
  /**
   * Options forwarded to floating-ui `autoUpdate` (e.g. `{ elementResize: false }`
   * to stop the floating element's OWN size changes from re-triggering a
   * reposition — the fix for a resize→reposition→re-hover loop). Ignored when
   * `autoUpdate` is `false`.
   */
  autoUpdateOptions?: Parameters<typeof import('@floating-ui/dom').autoUpdate>[3];
  /**
   * Called on every frame immediately BEFORE the position is computed. Use it to
   * mutate the reference/floating element first — e.g. publish the reference's
   * measured width to a CSS variable so `shift`/`size` measure the final width,
   * or clamp min/max width. Runs inside the `autoUpdate` loop.
   */
  beforeCompute?(): void;
  /**
   * Copy the nearest `data-theme` from this element onto the floating element at
   * placement time — so a layer portaled out of the component subtree keeps the
   * theme (guideline C-CS-10). Presets default this to the reference/trigger.
   */
  inheritThemeFrom?: HTMLElement;
  /** Escape hatch: a custom floating-ui platform (rarely needed — 1.8 handles shadow DOM). */
  platform?: Platform;
  /**
   * Narrow Floating UI's offset-parent search to the properties browsers reliably
   * honour as a fixed-positioning containing block (`transform` / `perspective` /
   * `filter` / `backdrop-filter` / qualifying `will-change`) — ignoring `contain`
   * and `container-type`, which the spec says create a CB but browsers do NOT
   * reliably honour for `position: fixed`, especially across shadow DOM. The
   * offset parent is resolved from the FLOATING element (never the reference — the
   * reference can itself be a CB, e.g. a badge cell with `transform` on hover, and
   * a portaled panel has a different CB than its reference).
   *
   * Sugar for building `{ ...floatingUiPlatform, getOffsetParent: () =>
   * getFixedPositionOffsetParent(floating) }` yourself and passing it as
   * {@link platform}. Ignored when an explicit `platform` is given (yours wins).
   * Pairs with {@link onDrift}. Default `false`.
   */
  fixedContainingBlock?: boolean;
  /** Extra viewport-edge padding (px) before `flip` switches sides. Default `0`. */
  flipPadding?: number;
  /**
   * Cap the floating element's height to the space available on the resolved side
   * (floating-ui `size()`), so it scrolls internally instead of overflowing the
   * viewport — a calendar/dropdown that should stay on-screen. `true` uses no
   * extra inset; `{ padding }` insets from the viewport edges. The floating
   * element needs its own inner scroll region (this only sets `max-height`).
   */
  maxHeight?: boolean | { padding?: number };
  /**
   * Cap the floating element's width to the space available on the resolved side
   * (floating-ui `size()`), so a user-resizable panel can't be dragged past the
   * viewport edge (and long content wraps instead of overflowing horizontally).
   * `true` uses no extra inset; `{ padding }` insets from the viewport edges.
   * Mirrors {@link maxHeight}; only sets `max-width`.
   */
  maxWidth?: boolean | { padding?: number };
  /**
   * Render an arrow that points at the reference. Core adds floating-ui's
   * `arrow()` middleware and, each frame, positions `element` along the resolved
   * side (centered via its own measured size, cleared/re-set on flip). `element`
   * must be a child of the floating element and is typically a small rotated square.
   */
  arrow?: { element: HTMLElement; padding?: number };
  /** Called after each placement with the resolved placement. */
  onPlaced?(placement: Placement): void;
  /** Called after each placement with the computed viewport coordinates + placement. */
  onComputed?(data: { x: number; y: number; placement: Placement }): void;
  /**
   * Called after a placement ONLY when the panel drifted from where it was
   * positioned — i.e. an ancestor establishes a fixed containing block the
   * heuristic doesn't recognise (typically `contain` / `container-type`). Not
   * called when the panel is on target. Core runs a {@link detectFixedDrift}
   * measurement each frame against the floating element's fixed-CB offset parent,
   * so it fires whenever drift persists — guard against repeated warnings on your
   * side (e.g. a once-per-instance flag). Intended to pair with
   * {@link fixedContainingBlock}; needs a real-element reference (skipped for a
   * virtual/cursor reference). The report carries the drift + likely CSS culprit.
   */
  onDrift?(report: DriftReport): void;
}

/** The teardown handle returned by {@link anchor}. */
export interface AnchorHandle {
  /** Recompute the position once, now. */
  update(): void;
  /** Stop `autoUpdate` and release listeners. Idempotent. */
  destroy(): void;
}
