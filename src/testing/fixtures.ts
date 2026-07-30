/**
 * Runner-agnostic DOM test fixtures for BlissElement-based components
 * (SPEC §12.4 "Testing utilities"). Pure DOM — no import of vitest/Playwright —
 * so the same helpers work under vitest+jsdom, a real browser, or any runner.
 * The deterministic "await the pipeline" signal is `element.whenSettled()` on
 * BlissElement itself; these helpers cover mount/teardown, upgrade timing, and
 * event assertions that every component test otherwise re-implements.
 */

/** Every container `mount`/`mountBeforeUpgrade` created, for {@link cleanup}. */
const MOUNTED = new Set<HTMLElement>();

/** Monotonic counter for {@link uniqueTag} — deterministic, no `Math.random`. */
let TAG_SEQ = 0;

/**
 * A fresh, valid custom-element tag name (`prefix-N`). Use one per test so a
 * class defined in one test never clashes with another (`customElements.define`
 * throws on a duplicate tag).
 */
export function uniqueTag(prefix = 'bliss-test'): string {
  return `${prefix}-${TAG_SEQ++}`;
}

/**
 * Idempotent `customElements.define`: defines `tag` only if it isn't already,
 * so re-running a test file (watch mode) doesn't throw "already defined".
 * Returns `tag` for chaining.
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): string {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
  return tag;
}

/** Options for {@link mount}. */
export interface MountOptions {
  /** Container to append into (default: a fresh `<div>` appended to `document.body`). */
  container?: HTMLElement;
}

/**
 * Mount an element (or an HTML string) into the document and track it for
 * {@link cleanup}. Given a string, its first element child is returned. The
 * element is connected, so a BlissElement runs its first `reinit()` + `connect()`
 * synchronously; `await el.whenSettled()` afterwards to await any further batch.
 */
export function mount<T extends Element = Element>(source: string | Element, opts?: MountOptions): T {
  const host = opts?.container ?? document.createElement('div');
  if (!opts?.container) {
    document.body.append(host);
    MOUNTED.add(host);
  }
  let el: Element | null;
  if (typeof source === 'string') {
    const tpl = document.createElement('template');
    tpl.innerHTML = source;
    host.append(tpl.content);
    el = host.firstElementChild;
  } else {
    host.append(source);
    el = source;
  }
  if (!el) throw new Error('mount(): source produced no element');
  return el as unknown as T;
}

/**
 * Exercise the **pre-upgrade capture** path: create the element and set
 * properties on it while it is a plain `HTMLElement` (before its class is
 * defined), then define the class so the upgrade runs. A correct BlissElement
 * captures those pre-set properties and routes them through its setters on
 * upgrade. `tag` should be unique (see {@link uniqueTag}).
 */
export function mountBeforeUpgrade<T extends Element = Element>(
  tag: string,
  ctor: CustomElementConstructor,
  configure: (el: Record<string, unknown>) => void,
  opts?: MountOptions,
): T {
  const host = opts?.container ?? document.createElement('div');
  if (!opts?.container) {
    document.body.append(host);
    MOUNTED.add(host);
  }
  const el = document.createElement(tag); // plain HTMLElement — not yet upgraded
  configure(el as unknown as Record<string, unknown>);
  host.append(el);
  defineOnce(tag, ctor); // in-DOM + define → upgrade runs the constructor now
  customElements.upgrade(el); // no-op if already upgraded; explicit for clarity
  return el as unknown as T;
}

/** Remove everything {@link mount}/{@link mountBeforeUpgrade} created. Call in `afterEach`. */
export function cleanup(): void {
  for (const host of MOUNTED) host.remove();
  MOUNTED.clear();
}

/** Resolve after the next microtask — awaits BlissElement's coalesced flush. */
export function nextTick(): Promise<void> {
  return Promise.resolve();
}

/** Resolve after the next animation frame (real browsers; falls back to a macrotask). */
export function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}
