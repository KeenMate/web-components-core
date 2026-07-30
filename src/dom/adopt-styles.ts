/**
 * Shadow-root style injection (SPEC §12.4). Two primitives for the two CSS
 * shapes every component re-rolls:
 *
 * - {@link adoptStyles} — STATIC, shared stylesheets (the `main.css?inline`
 *   pattern). One `CSSStyleSheet` per unique string, cached and shared across
 *   ALL instances via `adoptedStyleSheets` (that's what constructable sheets are
 *   for); falls back to a `<style>` element where unsupported; SSR-safe.
 * - {@link createStyleSlot} — a PER-INSTANCE, replaceable `<style>` slot (the
 *   `customStylesCallback` pattern: user CSS that changes at runtime). It keeps
 *   ONE element at a consistent position, so re-setting replaces rather than
 *   stacking, fixing the prepend-on-init / append-on-update drift components
 *   have today. `<style>`-based because user CSS may use `@import` (which
 *   constructable stylesheets reject).
 *
 * Core owns the injection mechanism only — the `@layer` order, which file lands
 * in which layer, and the Vite `?inline` import stay authoring concerns governed
 * by the CSS guidelines. These helpers take CSS strings; how you obtained them
 * is your business.
 */

/** Shared cache: one constructable sheet per unique CSS string, reused across roots/instances. */
const sheetCache = new Map<string, CSSStyleSheet>();
/** Per-root record of which strings have already been adopted (dedup across both paths). */
const adoptedByRoot = new WeakMap<object, Set<string>>();
/** Memoized result of the constructable-stylesheet feature probe. */
let constructableOk: boolean | undefined;

function supportsConstructable(root: DocumentOrShadowRoot): boolean {
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in root)) return false;
  if (constructableOk === undefined) {
    try {
      new CSSStyleSheet().replaceSync('');
      constructableOk = true;
    } catch {
      constructableOk = false;
    }
  }
  return constructableOk;
}

/**
 * Adopt one or more static stylesheets into `root` (a shadow root or document),
 * sharing one cached `CSSStyleSheet` per unique string across every instance.
 * Idempotent per root — re-adopting the same string is a no-op. No-op during SSR
 * (`document` absent).
 */
export function adoptStyles(root: DocumentOrShadowRoot, ...cssStrings: string[]): void {
  if (typeof document === 'undefined') return;

  let seen = adoptedByRoot.get(root);
  if (!seen) adoptedByRoot.set(root, (seen = new Set<string>()));
  const fresh = cssStrings.filter((css) => css && !seen!.has(css));
  if (fresh.length === 0) return;
  for (const css of fresh) seen.add(css);

  if (supportsConstructable(root)) {
    const sheets = fresh.map((css) => {
      let sheet = sheetCache.get(css);
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sheetCache.set(css, sheet);
      }
      return sheet;
    });
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
    return;
  }

  // Fallback: append a <style> per string.
  const target: Node = (root as Document).head ?? (root as unknown as Node);
  for (const css of fresh) {
    const style = document.createElement('style');
    style.textContent = css;
    target.appendChild(style);
  }
}

/** A single replaceable `<style>` slot (see {@link createStyleSlot}). */
export interface StyleSlot {
  /** Set the slot's CSS (creating/inserting the element on first non-empty value); falsy clears it. */
  set(css: string | null | undefined): void;
  /** Remove the element from the DOM (a later {@link set} re-inserts it). */
  clear(): void;
  /** Remove the element and drop the reference. */
  destroy(): void;
}

/** Options for {@link createStyleSlot}. */
export interface StyleSlotOptions {
  /** Insert at the start (`'first'`) or end (`'last'`) of the root. Default `'last'` (so it wins the cascade). */
  position?: 'first' | 'last';
  /** Optional class on the `<style>` element (e.g. for debugging / removal). */
  className?: string;
}

/**
 * Create a per-instance, replaceable style slot in `root`. Backs the
 * `customStylesCallback` pattern: call the callback, `slot.set(result)`; on the
 * next value, `set` again — the same element is reused at the same position, so
 * there is no stacking or prepend/append inconsistency. No-op during SSR.
 */
export function createStyleSlot(
  root: ShadowRoot | Document | HTMLElement,
  opts: StyleSlotOptions = {},
): StyleSlot {
  const position = opts.position ?? 'last';
  const target: Node = (root as Document).head ?? root;
  let element: HTMLStyleElement | null = null;

  const ensureInserted = (): HTMLStyleElement | null => {
    if (typeof document === 'undefined') return null;
    if (!element) {
      element = document.createElement('style');
      if (opts.className) element.className = opts.className;
    }
    if (element.parentNode !== target) {
      if (position === 'first' && target.firstChild) target.insertBefore(element, target.firstChild);
      else target.appendChild(element);
    }
    return element;
  };

  const clear = (): void => {
    element?.remove();
  };

  return {
    set(css) {
      if (!css) {
        clear();
        return;
      }
      const el = ensureInserted();
      if (el) el.textContent = css;
    },
    clear,
    destroy() {
      element?.remove();
      element = null;
    },
  };
}
