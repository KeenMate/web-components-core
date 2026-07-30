/**
 * `@keenmate/web-components-core/positioning` — floating-element positioning
 * over a single pinned `@floating-ui/dom` (SPEC §12.2). One low-level
 * {@link anchor} primitive plus the {@link createTooltip} / {@link createPopover}
 * presets that cover the tooltip and dropdown/popover shapes the five components
 * re-wrapped ~15 ways. A separate subpath so `@floating-ui/dom` stays opt-in and
 * out of the base import graph.
 */
export { anchor } from './anchor.js';
export { createTooltip } from './tooltip.js';
export { createPopover } from './popover.js';
export type {
  AnchorHandle,
  AnchorOptions,
  MatchWidth,
  Placement,
  Platform,
  Strategy,
  VirtualElement,
} from './types.js';
export type { TooltipDelay, TooltipHandle, TooltipOptions } from './tooltip.js';
export type { PopoverHandle, PopoverOptions } from './popover.js';
