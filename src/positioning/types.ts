/**
 * Shared types for the positioning module (SPEC §12.2). One low-level
 * {@link AnchorOptions} primitive plus the two preset option/handle shapes.
 * Re-exports the `@floating-ui/dom` types a caller needs so components import
 * them from core (one pinned version) instead of the raw package (which drifted
 * across 1.5/1.7 in the five shipping components).
 */
import type { Placement, Strategy, Platform, VirtualElement } from '@floating-ui/dom';

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
   * Keep the initial placement unless it truly cannot fit (flip returns to the
   * initial placement rather than reordering). Requires `flip`. Default `false`.
   */
  lockPlacement?: boolean;
  /** Keep the position updated on scroll/resize via floating-ui `autoUpdate`. Default `true`. */
  autoUpdate?: boolean;
  /**
   * Copy the nearest `data-theme` from this element onto the floating element at
   * placement time — so a layer portaled out of the component subtree keeps the
   * theme (guideline C-CS-10). Presets default this to the reference/trigger.
   */
  inheritThemeFrom?: HTMLElement;
  /** Escape hatch: a custom floating-ui platform (rarely needed — 1.8 handles shadow DOM). */
  platform?: Platform;
  /** Called after each placement with the resolved placement. */
  onPlaced?(placement: Placement): void;
}

/** The teardown handle returned by {@link anchor}. */
export interface AnchorHandle {
  /** Recompute the position once, now. */
  update(): void;
  /** Stop `autoUpdate` and release listeners. Idempotent. */
  destroy(): void;
}
