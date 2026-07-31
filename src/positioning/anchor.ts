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
  autoUpdate,
  computePosition,
  flip as flipMiddleware,
  offset as offsetMiddleware,
  shift as shiftMiddleware,
  size as sizeMiddleware,
  type Middleware,
} from '@floating-ui/dom';
import type { AnchorHandle, AnchorOptions } from './types.js';

type Reference = Parameters<typeof computePosition>[0];

/** Copy the nearest `data-theme` from `source` onto `target` (self or ancestor). */
function inheritTheme(source: HTMLElement, target: HTMLElement): void {
  const themed = source.closest?.('[data-theme]');
  const theme = themed?.getAttribute('data-theme');
  if (theme != null) target.setAttribute('data-theme', theme);
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
    middleware.push(flipMiddleware(opts.lockPlacement === true ? { fallbackStrategy: 'initialPlacement' } : {}));
  }

  const shift = opts.shift ?? 8;
  if (shift !== false) middleware.push(shiftMiddleware({ padding: shift }));

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

  const run = (): void => {
    opts.beforeCompute?.();
    void computePosition(reference, floating, {
      placement,
      strategy,
      middleware,
      ...(opts.platform ? { platform: opts.platform } : {}),
    }).then(({ x, y, placement: resolved }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
      if (freeze && !frozen) {
        // Pin the placement floating-ui just chose; stop flipping from now on.
        frozen = true;
        placement = resolved;
        flipEnabled = false;
        middleware = buildMiddleware(opts, false);
      }
      opts.onPlaced?.(resolved);
    });
  };

  let cleanup: (() => void) | undefined;
  if (opts.autoUpdate ?? true) cleanup = autoUpdate(reference, floating, run);
  else run();

  return {
    update: run,
    destroy() {
      cleanup?.();
      cleanup = undefined;
    },
  };
}
