/**
 * Device / viewport / orientation detection (SPEC §12.9). A single, lazily
 * started, ref-counted observable over `matchMedia` + resize — the shared
 * "what kind of screen am I on" signal every component re-derives today.
 *
 * The load-bearing distinction is **capability, not size**: a phone reports a
 * coarse pointer and no hover *regardless of width* (a landscape phone is wide
 * but still wants a fullscreen calendar, because a floating panel near an input
 * thrashes the soft keyboard). So the snapshot carries pointer/hover facts
 * alongside width, and {@link EnvironmentSnapshot.isTouchPrimary} is the
 * "be aggressive out of the box" flag: coarse pointer AND no hover.
 *
 * Detection is **feature-detection, not UA sniffing** — media queries are both
 * reliable and already reactive (orientation flips, a resize, a laptop with a
 * touchscreen all fire `change`). SSR-safe: with no `window` (or no
 * `matchMedia`) it returns a static desktop default and a no-op unsubscribe.
 *
 * Zero runtime deps; lives in the main index so any component can read it
 * without an extra import path. Components normally consume it through
 * `BlissElement`'s `environmentChanged()` hook rather than subscribing directly.
 */

/** The primary pointing device: `coarse` = touch/stylus, `fine` = mouse/trackpad. */
export type PointerType = 'coarse' | 'fine' | 'none';

/** Screen orientation, from `(orientation: portrait)`. */
export type Orientation = 'portrait' | 'landscape';

/**
 * Best-effort operating-system family. Unlike every other field this is
 * **UA/Client-Hints-derived, not feature-detected** — there is no media query
 * for "is this Apple". Treat it as a *hint* for genuine OS-specific quirks (an
 * iOS-Safari-only bug), NOT as a behavior gate where a capability query exists
 * (use {@link EnvironmentSnapshot.isTouchPrimary} for "phone/tablet" decisions).
 * Constant for the session.
 */
export type OS = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown';

/** A named breakpoint → its inclusive max viewport width in px (`Infinity` for the largest). */
export type BreakpointMap = Record<string, number>;

/** An immutable read of the current device/viewport/orientation state. */
export interface EnvironmentSnapshot {
  /** Primary pointer capability: `(pointer: coarse)` → `coarse`, else `fine`; `none` when neither matches. */
  readonly pointer: PointerType;
  /** Any pointer is coarse — touch is available at all, even if a mouse is primary (`(any-pointer: coarse)`). */
  readonly hasCoarsePointer: boolean;
  /** The primary pointer can hover (`(hover: hover)`) — false on touch-first devices. */
  readonly canHover: boolean;
  /**
   * The "treat me like a phone/tablet" flag: coarse primary pointer AND no hover.
   * This — not width — is the signal for aggressive mobile defaults (e.g. a
   * fullscreen calendar), because it holds in landscape where width alone lies.
   */
  readonly isTouchPrimary: boolean;
  /** `portrait` or `landscape`, from `(orientation: portrait)`. */
  readonly orientation: Orientation;
  /** `window.innerWidth` at the last sample. */
  readonly viewportWidth: number;
  /** `window.innerHeight` at the last sample. */
  readonly viewportHeight: number;
  /** The resolved breakpoint name for {@link viewportWidth} (see {@link configureBreakpoints}). */
  readonly breakpoint: string;
  /**
   * Best-effort OS family (UA/Client-Hints hint, not feature detection). Constant
   * for the session. See {@link OS} — prefer {@link isTouchPrimary} for behavior.
   */
  readonly os: OS;
  /** Convenience: `os` is `ios` or `macos`. A UA hint — see {@link os}. */
  readonly isApple: boolean;
  /** Convenience: `os` is `android`. A UA hint — see {@link os}. */
  readonly isAndroid: boolean;
}

/** A subscriber notified with each new snapshot (fired immediately on subscribe unless opted out). */
export type EnvironmentListener = (snapshot: EnvironmentSnapshot) => void;

/** Options for {@link observeEnvironment}. */
export interface ObserveOptions {
  /** Fire the listener synchronously with the current snapshot on subscribe. Default `true`. */
  immediate?: boolean;
}

/** The static snapshot returned during SSR / when no media-query support exists. */
const SSR_DEFAULT: EnvironmentSnapshot = {
  pointer: 'fine',
  hasCoarsePointer: false,
  canHover: true,
  isTouchPrimary: false,
  orientation: 'landscape',
  viewportWidth: 1024,
  viewportHeight: 768,
  breakpoint: 'desktop',
  os: 'unknown',
  isApple: false,
  isAndroid: false,
};

/** Default breakpoints: phone ≤ 640, tablet ≤ 1024, everything larger is desktop. */
const DEFAULT_BREAKPOINTS: BreakpointMap = { mobile: 640, tablet: 1024, desktop: Infinity };

/** Breakpoints as `[name, maxWidth]` sorted ascending by width; last entry is the catch-all. */
let breakpoints: Array<[string, number]> = sortBreakpoints(DEFAULT_BREAKPOINTS);

const subscribers = new Set<EnvironmentListener>();
/** Cached snapshot while subscribed; `null` when idle (no listeners) so a fresh read recomputes. */
let current: EnvironmentSnapshot | null = null;
/** The live `MediaQueryList`s, held so we can detach on the last unsubscribe. */
let mqls: MediaQueryList[] = [];
let rafScheduled = false;

function sortBreakpoints(map: BreakpointMap): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => a[1] - b[1]);
}

function resolveBreakpoint(width: number): string {
  for (const [name, max] of breakpoints) {
    if (width <= max) return name;
  }
  // No catch-all matched (all finite and width exceeds them): fall to the largest.
  const largest = breakpoints[breakpoints.length - 1];
  return largest ? largest[0] : 'desktop';
}

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Client Hints surface (Chromium-only); typed narrowly since lib.dom lags. */
interface UADataLike {
  platform?: string;
  mobile?: boolean;
}

/** A "Macintosh" UA with a real touchscreen is an iPad (iPadOS 13+ masquerades as desktop Safari). */
function looksLikeIpad(): boolean {
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Best-effort OS family. Prefers `navigator.userAgentData.platform` (Client
 * Hints), falls back to the UA string for Safari/Firefox, and corrects the
 * iPad-as-Mac masquerade via `maxTouchPoints`. Constant for the session — no
 * media query can report this, so it is UA-derived by nature.
 */
function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'unknown';

  const uaData = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
  const platform = uaData?.platform?.toLowerCase();
  if (platform) {
    if (platform.includes('android')) return 'android';
    if (platform.includes('ios')) return 'ios';
    if (platform.includes('mac')) return looksLikeIpad() ? 'ios' : 'macos';
    if (platform.includes('windows')) return 'windows';
    if (platform.includes('linux')) return 'linux';
  }

  const ua = navigator.userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipod|ipad/i.test(ua)) return 'ios';
  // iPadOS 13+ reports a desktop "Macintosh" UA; a touchscreen gives it away.
  if (/macintosh|mac os x/i.test(ua)) return looksLikeIpad() ? 'ios' : 'macos';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return 'unknown';
}

/** Memoized OS — it never changes within a session. */
let osCache: OS | undefined;
function getOS(): OS {
  return (osCache ??= detectOS());
}

function matches(query: string): boolean {
  return canMatchMedia() && window.matchMedia(query).matches;
}

/** Sample the environment right now (pure read; does not attach listeners). */
function computeSnapshot(): EnvironmentSnapshot {
  if (!canMatchMedia()) return { ...SSR_DEFAULT };

  const hasCoarsePointer = matches('(any-pointer: coarse)');
  const coarsePrimary = matches('(pointer: coarse)');
  const finePrimary = matches('(pointer: fine)');
  const canHover = matches('(hover: hover)');
  const pointer: PointerType = coarsePrimary ? 'coarse' : finePrimary ? 'fine' : 'none';
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const os = getOS();

  return {
    pointer,
    hasCoarsePointer,
    canHover,
    isTouchPrimary: coarsePrimary && !canHover,
    orientation: matches('(orientation: portrait)') ? 'portrait' : 'landscape',
    viewportWidth,
    viewportHeight,
    breakpoint: resolveBreakpoint(viewportWidth),
    os,
    isApple: os === 'ios' || os === 'macos',
    isAndroid: os === 'android',
  };
}

function snapshotsEqual(a: EnvironmentSnapshot, b: EnvironmentSnapshot): boolean {
  return (
    a.pointer === b.pointer &&
    a.hasCoarsePointer === b.hasCoarsePointer &&
    a.canHover === b.canHover &&
    a.isTouchPrimary === b.isTouchPrimary &&
    a.orientation === b.orientation &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.breakpoint === b.breakpoint
  );
}

/** Recompute and, if anything changed, cache + notify every subscriber. */
function recompute(): void {
  const next = computeSnapshot();
  if (current && snapshotsEqual(current, next)) return;
  current = next;
  for (const listener of [...subscribers]) listener(next);
}

const onMediaChange = (): void => recompute();

const onResize = (): void => {
  // Coalesce resize bursts to one recompute per frame where rAF exists.
  if (typeof requestAnimationFrame === 'function') {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      recompute();
    });
  } else {
    recompute();
  }
};

function addMqlListener(mql: MediaQueryList): void {
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onMediaChange);
  else if (typeof mql.addListener === 'function') mql.addListener(onMediaChange); // older Safari
}

function removeMqlListener(mql: MediaQueryList): void {
  if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onMediaChange);
  else if (typeof mql.removeListener === 'function') mql.removeListener(onMediaChange);
}

/** Attach the shared media-query + resize listeners on the first subscriber. */
function start(): void {
  if (!canMatchMedia()) {
    current = { ...SSR_DEFAULT };
    return;
  }
  mqls = [
    window.matchMedia('(pointer: coarse)'),
    window.matchMedia('(pointer: fine)'),
    window.matchMedia('(any-pointer: coarse)'),
    window.matchMedia('(hover: hover)'),
    window.matchMedia('(orientation: portrait)'),
  ];
  for (const mql of mqls) addMqlListener(mql);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', onResize);
  current = computeSnapshot();
}

/** Detach every listener and drop cached state on the last unsubscribe. */
function stop(): void {
  for (const mql of mqls) removeMqlListener(mql);
  mqls = [];
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('resize', onResize);
  }
  rafScheduled = false;
  current = null;
}

/**
 * Read the current environment synchronously. Returns the cached snapshot while
 * anything is subscribed, otherwise samples fresh (without attaching listeners).
 * The imperative-read companion to {@link observeEnvironment} — use it inside a
 * component's `reinit()`/`connect()` to configure initial state.
 */
export function getEnvironment(): EnvironmentSnapshot {
  return current ?? computeSnapshot();
}

/**
 * Subscribe to environment changes. The listener fires immediately with the
 * current snapshot (unless `immediate: false`), then again whenever the pointer,
 * hover, orientation, viewport size, or resolved breakpoint changes. Returns an
 * unsubscribe function; the shared `matchMedia`/resize listeners are attached on
 * the first subscriber and torn down when the last one leaves. No-op-safe during
 * SSR (fires once with the desktop default, returns a no-op unsubscribe).
 */
export function observeEnvironment(listener: EnvironmentListener, opts: ObserveOptions = {}): () => void {
  const first = subscribers.size === 0;
  subscribers.add(listener);
  if (first) start();
  if (opts.immediate !== false) listener(getEnvironment());

  let live = true;
  return () => {
    if (!live) return;
    live = false;
    subscribers.delete(listener);
    if (subscribers.size === 0) stop();
  };
}

/**
 * Redefine the breakpoint buckets used to resolve {@link EnvironmentSnapshot.breakpoint}.
 * Keys are names, values are inclusive max widths in px (use `Infinity` for the
 * largest bucket). Applies globally and immediately re-notifies active
 * subscribers if the resolved breakpoint changed. Defaults:
 * `{ mobile: 640, tablet: 1024, desktop: Infinity }`.
 */
export function configureBreakpoints(map: BreakpointMap): void {
  breakpoints = sortBreakpoints(map);
  if (subscribers.size > 0) recompute();
}

// ── device classification (capability, not width) ──────────────────────────

/**
 * A device's coarse class, derived from **capability + physical size**, NOT the
 * viewport-width {@link EnvironmentSnapshot.breakpoint}. The two axes differ on
 * purpose: `breakpoint` answers "how wide is the window" (a narrowed desktop is
 * `mobile`); `deviceClass` answers "what kind of device is this" (a narrowed
 * desktop stays `desktop`, a landscape iPad stays `tablet`). This is the axis to
 * key mobile/tablet UX off — it's the one every KM component must agree on.
 */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

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
 * headroom over ~480) while handing tablets and opened foldables to the tablet
 * class. A hard constant on purpose: the whole point is that "what is a phone"
 * can't drift per app.
 */
export const TABLET_MIN_SHORT_SIDE = 600;

/**
 * Classify the device from the live environment (SPEC §12.9). Capability decides
 * first — a non-`isTouchPrimary` device is always `desktop`, at any window width,
 * so a shrunk desktop window keeps its `desktop` class (and a floating dropdown,
 * not a fullscreen sheet). Only touch-primary devices consult the size line: the
 * shorter viewport side below {@link TABLET_MIN_SHORT_SIDE} ⇒ `mobile`, else
 * `tablet` (orientation-robust — a landscape phone still reads as `mobile`).
 *
 * This is the shared *classification*; how each class maps to a presentation is a
 * component decision (see `resolvePresentation`).
 */
export function classifyDevice(env: EnvironmentSnapshot): DeviceClass {
  if (!env.isTouchPrimary) return 'desktop';
  const shortSide = Math.min(env.viewportWidth, env.viewportHeight);
  return shortSide < TABLET_MIN_SHORT_SIDE ? 'mobile' : 'tablet';
}

/** Test-only: detach listeners and reset breakpoints + cache to defaults. */
export function __resetEnvironment(): void {
  subscribers.clear();
  stop();
  breakpoints = sortBreakpoints(DEFAULT_BREAKPOINTS);
  osCache = undefined;
}
