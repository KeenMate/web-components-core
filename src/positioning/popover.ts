/**
 * `createPopover()` — the dropdown / popover / panel preset (SPEC §12.2),
 * covering the multiselect dropdown, daterangepicker calendar, grid
 * contextmenu/datepicker/dropdown/toolbar, and dropzone popover. Defaults to
 * `placement: 'bottom-start'`, portals the panel to `document.body`, matches the
 * reference width on request (`size()`, replacing the per-component width hacks),
 * and keeps position updated while open.
 */
import { anchor } from './anchor.js';
import type { AnchorHandle, MatchWidth, Placement, Platform, Strategy } from './types.js';

/** A DOM element or a floating-ui `VirtualElement` to anchor against. */
type Reference = Parameters<typeof anchor>[1];

/** Options for {@link createPopover}. */
export interface PopoverOptions {
  /** The element (or virtual element) the panel anchors to. */
  reference: Reference;
  /** The panel element to position and portal. */
  panel: HTMLElement;
  /** Where to mount the panel while open. Default `document.body`. */
  container?: HTMLElement;
  /** Preferred placement. Default `'bottom-start'`. */
  placement?: Placement;
  /** Gap from the reference, in px. Default `4`. */
  offset?: number;
  /** Match the reference's width. Default `false`. */
  matchWidth?: MatchWidth;
  /**
   * Placement stability (see {@link AnchorOptions.lockPlacement}): `true` returns
   * to the initial placement on overflow, `'freeze'` flips once then pins (the
   * "open where it fits, then don't jump" dropdown behaviour). Default `false`.
   */
  lockPlacement?: boolean | 'freeze';
  /** Allow flipping to the opposite side on overflow. Default `true`. */
  flip?: boolean;
  /** Shift padding in px to stay in view, or `false` to disable. Default `8`. */
  shift?: number | false;
  /** Positioning strategy. Default `'fixed'`. */
  strategy?: Strategy;
  /** Keep the position updated on scroll/resize via floating-ui `autoUpdate`. Default `true`. */
  autoUpdate?: boolean;
  /** Element to inherit `data-theme` from (C-CS-10). Default: the reference if it is an element. */
  inheritThemeFrom?: HTMLElement;
  /**
   * Per-frame hook run immediately before positioning — publish the reference's
   * measured width to a CSS var, clamp min/max width, etc. (see
   * {@link AnchorOptions.beforeCompute}).
   */
  beforeCompute?(): void;
  /** Escape hatch: a custom floating-ui platform (e.g. a narrowed shadow-DOM containing-block heuristic). */
  platform?: Platform;
  /** Called after each placement with the resolved placement. */
  onPlaced?(placement: Placement): void;
}

/** Handle returned by {@link createPopover}. */
export interface PopoverHandle {
  /** Whether the panel is currently open. */
  readonly isOpen: boolean;
  /** Mount + position the panel and keep it placed. */
  open(): void;
  /** Unmount the panel and stop positioning. */
  close(): void;
  /** Recompute the position once (no-op when closed). */
  update(): void;
  /** Close and release everything. Idempotent. */
  destroy(): void;
}

export function createPopover(opts: PopoverOptions): PopoverHandle {
  const container = opts.container ?? document.body;
  let handle: AnchorHandle | undefined;
  let open = false;

  const defaultTheme = opts.inheritThemeFrom ?? (opts.reference instanceof HTMLElement ? opts.reference : undefined);

  return {
    get isOpen() {
      return open;
    },
    open() {
      if (open) return;
      open = true;
      container.append(opts.panel);
      handle = anchor(opts.panel, opts.reference, {
        placement: opts.placement ?? 'bottom-start',
        strategy: opts.strategy,
        offset: opts.offset,
        matchWidth: opts.matchWidth,
        lockPlacement: opts.lockPlacement,
        ...(opts.flip !== undefined ? { flip: opts.flip } : {}),
        ...(opts.shift !== undefined ? { shift: opts.shift } : {}),
        ...(opts.autoUpdate !== undefined ? { autoUpdate: opts.autoUpdate } : {}),
        ...(opts.beforeCompute ? { beforeCompute: opts.beforeCompute } : {}),
        ...(opts.platform ? { platform: opts.platform } : {}),
        ...(defaultTheme ? { inheritThemeFrom: defaultTheme } : {}),
        ...(opts.onPlaced ? { onPlaced: opts.onPlaced } : {}),
      });
    },
    close() {
      if (!open) return;
      open = false;
      handle?.destroy();
      handle = undefined;
      opts.panel.remove();
    },
    update() {
      handle?.update();
    },
    destroy() {
      this.close();
    },
  };
}
