/**
 * `@keenmate/web-components-core/testing` — runner-agnostic test fixtures for
 * BlissElement components (SPEC §12.4). Pure DOM, zero dependencies; pair with
 * `element.whenSettled()` to await the reactive pipeline deterministically.
 */
export {
  cleanup,
  defineOnce,
  mount,
  mountBeforeUpgrade,
  nextFrame,
  nextTick,
  uniqueTag,
  type MountOptions,
} from './fixtures.js';
export { listen, type EventSpy } from './event-spy.js';
