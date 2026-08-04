/**
 * `anchor()` — the low-level positioning primitive (SPEC §12.2). Places a
 * floating element against a reference and (by default) keeps it placed via
 * floating-ui `autoUpdate`, unifying the ~15 hand-rolled call sites across the
 * five components: `'fixed'` strategy by default, the recurring
 * `offset → (size) → flip → shift` middleware stack, width-matching via `size()`
 * (replacing three different hacks), and `data-theme` inheritance for portaled
 * layers (C-CS-10). The two presets ({@link createTooltip}, {@link createPopover})
 * are thin wrappers over this.
 */
import {
  arrow as arrowMiddleware,
  autoUpdate,
  computePosition,
  flip as flipMiddleware,
  offset as offsetMiddleware,
  platform as floatingUiPlatform,
  shift as shiftMiddleware,
  size as sizeMiddleware,
  type Middleware,
  type Platform,
} from '@floating-ui/dom';
import { detectFixedDrift, getFixedPositionOffsetParent } from './containing-block.js';
import type { AnchorHandle, AnchorOptions, Placement } from './types.js';

type Reference = Parameters<typeof computePosition>[0];

/** Copy the nearest `data-theme` from `source` onto `target` (self or ancestor). */
function inheritTheme(source: HTMLElement, target: HTMLElement): void {
  const themed = source.closest?.('[data-theme]');
  const theme = themed?.getAttribute('data-theme');
  if (theme != null) target.setAttribute('data-theme', theme);
}

const OPPOSITE_SIDE = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;

/** Position an arrow element on the side facing the reference (centered via its own size). */
function positionArrow(el: HTMLElement, placement: Placement, data: { x?: number; y?: number } | undefined): void {
  if (!data) return;
  const side = placement.split('-')[0] as keyof typeof OPPOSITE_SIDE;
  const staticSide = OPPOSITE_SIDE[side];
  el.style.left = data.x != null ? `${data.x}px` : '';
  el.style.top = data.y != null ? `${data.y}px` : '';
  el.style.right = '';
  el.style.bottom = '';
  el.style[staticSide] = `-${el.offsetWidth / 2}px`;
}

/**
 * Build the middleware stack in the canonical order: offset → size → flip → shift.
 * `flipEnabled` lets the caller drop `flip` after freezing (`lockPlacement: 'freeze'`).
 */
function buildMiddleware(opts: AnchorOptions, flipEnabled: boolean): Middleware[] {
  const middleware: Middleware[] = [offsetMiddleware(opts.offset ?? 4)];

  if (opts.matchWidth) {
    const mode = opts.matchWidth;
    middleware.push(
      sizeMiddleware({
        apply({ rects, elements }) {
          const width = `${rects.reference.width}px`;
          if (mode === 'exact') elements.floating.style.width = width;
          else elements.floating.style.minWidth = width;
        },
      }),
    );
  }

  if (flipEnabled) {
    // lockPlacement:true — prefer returning to the initial placement over reordering.
    // ('freeze' flips normally on the first frame, then this rebuilds without flip.)
    middleware.push(
      flipMiddleware({
        ...(opts.lockPlacement === true ? { fallbackStrategy: 'initialPlacement' } : {}),
        ...(opts.flipPadding != null ? { padding: opts.flipPadding } : {}),
      }),
    );
  }

  const shift = opts.shift ?? 8;
  if (shift !== false) middleware.push(shiftMiddleware({ padding: shift }));

  // Height-cap (calendar / dropdown): scroll internally instead of overflowing.
  if (opts.maxHeight) {
    const padding = typeof opts.maxHeight === 'object' ? opts.maxHeight.padding : undefined;
    middleware.push(
      sizeMiddleware({
        padding,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    );
  }

  // Width-cap (user-resizable panel): stop the floating element overflowing the
  // viewport horizontally. Mirrors maxHeight; only sets max-width.
  if (opts.maxWidth) {
    const padding = typeof opts.maxWidth === 'object' ? opts.maxWidth.padding : undefined;
    middleware.push(
      sizeMiddleware({
        padding,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
        },
      }),
    );
  }

  // Arrow last (floating-ui requirement): it reads the final resolved coordinates.
  if (opts.arrow) middleware.push(arrowMiddleware({ element: opts.arrow.element, padding: opts.arrow.padding }));

  return middleware;
}

/**
 * Position `floating` against `reference` and keep it there. Returns a handle:
 * `update()` recomputes once, `destroy()` stops `autoUpdate`. The `floating`
 * element must already be in the document (so it can be measured); the presets
 * handle mounting.
 */
export function anchor(
  floating: HTMLElement,
  reference: Reference,
  opts: AnchorOptions = {},
): AnchorHandle {
  const strategy = opts.strategy ?? 'fixed';

  if (opts.inheritThemeFrom) inheritTheme(opts.inheritThemeFrom, floating);

  floating.style.position = strategy;
  floating.style.left = '0';
  floating.style.top = '0';

  // `placement`/`middleware` are mutable so `lockPlacement: 'freeze'` can pin the
  // first resolved placement and drop `flip` for every subsequent frame.
  let placement = opts.placement ?? 'bottom-start';
  let flipEnabled = opts.flip ?? true;
  let middleware = buildMiddleware(opts, flipEnabled);
  const freeze = opts.lockPlacement === 'freeze';
  let frozen = false;

  // `fixedContainingBlock` sugar: narrow floating-ui's offset-parent search to the
  // CB properties browsers reliably honour for `position: fixed`, resolved from the
  // FLOATING element (not the reference — see the option doc). An explicit `platform`
  // wins over the sugar.
  const useFixedCB = !!opts.fixedContainingBlock && !opts.platform;
  const effectivePlatform: Platform | undefined =
    opts.platform ??
    (useFixedCB
      ? { ...floatingUiPlatform, getOffsetParent: () => getFixedPositionOffsetParent(floating) }
      : undefined);

  const run = (): void => {
    opts.beforeCompute?.();
    void computePosition(reference, floating, {
      placement,
      strategy,
      middleware,
      ...(effectivePlatform ? { platform: effectivePlatform } : {}),
    }).then(({ x, y, placement: resolved, middlewareData }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
      if (opts.arrow) positionArrow(opts.arrow.element, resolved, middlewareData.arrow);
      if (freeze && !frozen) {
        // Pin the placement floating-ui just chose; stop flipping from now on.
        frozen = true;
        placement = resolved;
        flipEnabled = false;
        middleware = buildMiddleware(opts, false);
      }
      opts.onPlaced?.(resolved);
      opts.onComputed?.({ x, y, placement: resolved });
      if (opts.onDrift && reference instanceof Element) {
        // Measure against the same frame floating-ui used: the fixed-CB offset parent
        // when the sugar is on, else the viewport. Only reports when actually drifted.
        const offsetParent = useFixedCB ? getFixedPositionOffsetParent(floating) : window;
        const report = detectFixedDrift({ panel: floating, reference, expectedX: x, expectedY: y, offsetParent });
        if (report) opts.onDrift(report);
      }
    });
  };

  let cleanup: (() => void) | undefined;
  if (opts.autoUpdate ?? true) cleanup = autoUpdate(reference, floating, run, opts.autoUpdateOptions);
  else run();

  return {
    update: run,
    destroy() {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
