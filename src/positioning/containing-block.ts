/**
 * Fixed-positioning containing-block helpers + a drift diagnostic (SPEC §12.2).
 *
 * A `position: fixed` element is normally positioned relative to the viewport, so
 * Floating UI's computed coordinates land it exactly there. But an ancestor with
 * `transform` / `perspective` / `filter` / `backdrop-filter` / a qualifying
 * `will-change` (and, per spec but NOT reliably honoured by browsers, `contain` /
 * `container-type`) establishes a *containing block* for fixed descendants: the
 * browser then measures those coordinates from that ancestor's padding box and
 * the panel drifts. These helpers let a component
 *   1. narrow Floating UI's offset-parent search to what browsers reliably honour
 *      ({@link getFixedPositionOffsetParent}, used via `anchor`'s `platform` hatch), and
 *   2. detect + explain the drift when it still happens ({@link detectFixedDrift}),
 *      so it can warn the developer instead of silently mis-placing a panel.
 *
 * These read live layout (getBoundingClientRect / getComputedStyle) — meaningful
 * only in a real browser; they live in the positioning subpath, out of the base
 * import graph.
 */

/** Ascend to `node`'s parent, hopping a ShadowRoot boundary to its host. */
function ascend(node: Node): Node | null {
  const parent = (node as { parentNode?: Node | null }).parentNode ?? null;
  return parent instanceof ShadowRoot ? parent.host : parent;
}

/** Does `cs` set a property that reliably establishes a fixed-positioning containing block? */
function establishesFixedContainingBlock(cs: CSSStyleDeclaration): boolean {
  if (cs.transform !== 'none') return true;
  if (cs.perspective !== 'none') return true;
  if (cs.filter !== 'none') return true;
  const bdf = (cs as { backdropFilter?: string }).backdropFilter;
  if (bdf && bdf !== 'none') return true;
  if (cs.willChange && /\b(transform|filter|perspective)\b/.test(cs.willChange)) return true;
  return false;
}

/**
 * The element `position: fixed` descendants of `el` are actually anchored to, or
 * `window` (the viewport) when none. A drop-in `getOffsetParent` for Floating
 * UI's `platform` that — unlike its default — omits `contain` / `container-type`,
 * which the spec says create a containing block but browsers do NOT reliably
 * honour for fixed positioning (especially across shadow-DOM). Crosses shadow
 * boundaries so it sees the host's light-DOM ancestors too.
 */
export function getFixedPositionOffsetParent(el: Element): Element | Window {
  let node: Node | null = el;
  while (node) {
    if (node === document.body || node === document.documentElement) break;
    if (node instanceof Element && establishesFixedContainingBlock(getComputedStyle(node))) return node;
    node = ascend(node);
  }
  return window;
}

/**
 * Walk up from `el` and return the first ancestor whose viewport rect matches the
 * observed drift — the containing block the browser most likely anchored a fixed
 * panel to. `null` if none matches (drift from something else: visual viewport,
 * iframe, scrollbar gutter, …).
 */
export function findContainingBlockCulprit(el: Element, driftX: number, driftY: number): Element | null {
  let node: Node | null = el;
  while (node) {
    if (node === document.body || node === document.documentElement) break;
    if (node instanceof Element) {
      const rect = node.getBoundingClientRect();
      if (Math.abs(rect.x - driftX) < 2 && Math.abs(rect.y - driftY) < 2) return node;
    }
    node = ascend(node);
  }
  return null;
}

/** The containing-block-establishing CSS set on `el`, for a "likely culprit: has …" hint. */
export function describeContainingBlockProps(el: Element): string {
  const cs = getComputedStyle(el);
  const props: string[] = [];
  if (cs.transform !== 'none') props.push(`transform: ${cs.transform}`);
  if (cs.perspective !== 'none') props.push(`perspective: ${cs.perspective}`);
  if (cs.filter !== 'none') props.push(`filter: ${cs.filter}`);
  const bdf = (cs as { backdropFilter?: string }).backdropFilter;
  if (bdf && bdf !== 'none') props.push(`backdrop-filter: ${bdf}`);
  if (cs.willChange && /\b(transform|filter|perspective)\b/.test(cs.willChange)) props.push(`will-change: ${cs.willChange}`);
  if (cs.contain && /\b(paint|layout|strict|content)\b/.test(cs.contain)) props.push(`contain: ${cs.contain}`);
  const ct = (cs as { containerType?: string }).containerType;
  if (ct && ct !== 'normal') props.push(`container-type: ${ct}`);
  return props.join('; ');
}

/** A short `<tag#id.class>` description of `el` (up to two classes), for logs. */
function describeElement(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const cls =
    typeof el.className === 'string' && el.className
      ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

/** A detected drift: how far off, and the likely CSS culprit. */
export interface DriftReport {
  /** Horizontal drift in px (rendered − expected, in viewport space). */
  driftX: number;
  /** Vertical drift in px. */
  driftY: number;
  /** The ancestor that most likely anchored the panel, or `null` if unidentified. */
  culprit: Element | null;
  /** `<tag#id.class>` for `culprit`, or "an ancestor element (could not auto-identify)". */
  culpritDescription: string;
  /** The containing-block CSS on `culprit` (empty when `culprit` is null). */
  culpritCss: string;
}

/**
 * Verify a fixed panel landed where it was positioned, and explain it if not.
 *
 * `expectedX`/`expectedY` are the coordinates written to the panel (from
 * `anchor`/Floating UI). They are relative to `offsetParent` — the viewport when
 * `getFixedPositionOffsetParent` found no anchoring ancestor, else that ancestor's
 * padding box, so this translates the expectation into viewport space before
 * comparing to the panel's actual rect. Returns `null` when the panel is within
 * `tolerance` (default `1.5`px) — i.e. no meaningful drift.
 */
export function detectFixedDrift(opts: {
  panel: HTMLElement;
  reference: Element;
  expectedX: number;
  expectedY: number;
  offsetParent: Element | Window;
  tolerance?: number;
}): DriftReport | null {
  const tolerance = opts.tolerance ?? 1.5;

  let originX = 0;
  let originY = 0;
  if (opts.offsetParent instanceof Element) {
    const cbRect = opts.offsetParent.getBoundingClientRect();
    const cbStyle = getComputedStyle(opts.offsetParent);
    originX = cbRect.x + (parseFloat(cbStyle.borderLeftWidth) || 0);
    originY = cbRect.y + (parseFloat(cbStyle.borderTopWidth) || 0);
  }

  const rect = opts.panel.getBoundingClientRect();
  const driftX = rect.x - (originX + opts.expectedX);
  const driftY = rect.y - (originY + opts.expectedY);
  if (Math.abs(driftX) < tolerance && Math.abs(driftY) < tolerance) return null;

  const culprit = findContainingBlockCulprit(opts.reference, driftX, driftY);
  return {
    driftX,
    driftY,
    culprit,
    culpritDescription: culprit ? describeElement(culprit) : 'an ancestor element (could not auto-identify)',
    culpritCss: culprit ? describeContainingBlockProps(culprit) : '',
  };
}
