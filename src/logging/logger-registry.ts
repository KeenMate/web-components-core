/**
 * Associates a tag name with the {@link LoggerBundle} its component was built
 * with, so `BlissElement` can produce instance-scoped loggers (`this.log`)
 * without the component threading the bundle through every element (SPEC §12.3).
 * `registerComponent()` populates it from the `logging` option; the element base
 * reads it lazily by `localName`.
 */
import type { LoggerBundle } from './create-loggers.js';

const BY_TAG = new Map<string, LoggerBundle<string>>();

/** Record the bundle a component registered under `tagName`. */
export function attachLoggerBundle(tagName: string, bundle: LoggerBundle<string>): void {
  BY_TAG.set(tagName.toLowerCase(), bundle);
}

/** The bundle registered for `tagName`, if any. */
export function getLoggerBundle(tagName: string): LoggerBundle<string> | undefined {
  return BY_TAG.get(tagName.toLowerCase());
}
