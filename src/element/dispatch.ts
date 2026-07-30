/** Typed `CustomEvent` dispatch. Defaults to `bubbles` + `composed` so events cross shadow roots. */
export interface DispatchOptions {
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
}

/**
 * Dispatch a typed `CustomEvent<T>` from `target`. Returns `false` when a
 * cancelable event was `preventDefault()`-ed, mirroring `dispatchEvent`.
 */
export function dispatch<T>(
  target: EventTarget,
  name: string,
  detail?: T,
  opts: DispatchOptions = {},
): boolean {
  return target.dispatchEvent(
    new CustomEvent<T>(name, {
      detail,
      bubbles: opts.bubbles ?? true,
      composed: opts.composed ?? true,
      cancelable: opts.cancelable ?? false,
    }),
  );
}
