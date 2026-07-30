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

/** Build the middleware stack in the canonical order: offset → size → flip → shift. */
function buildMiddleware(opts: AnchorOptions): Middleware[] {
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

  if (opts.flip ?? true) {
    // lockPlacement: prefer returning to the initial placement over reordering.
    middleware.push(flipMiddleware(opts.lockPlacement ? { fallbackStrategy: 'initialPlacement' } : {}));
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
  const placement = opts.placement ?? 'bottom-start';

  if (opts.inheritThemeFrom) inheritTheme(opts.inheritThemeFrom, floating);

  floating.style.position = strategy;
  floating.style.left = '0';
  floating.style.top = '0';

  const middleware = buildMiddleware(opts);

  const run = (): void => {
    void computePosition(reference, floating, {
      placement,
      strategy,
      middleware,
      ...(opts.platform ? { platform: opts.platform } : {}),
    }).then(({ x, y, placement: resolved }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
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
