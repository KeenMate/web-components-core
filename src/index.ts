/** `@keenmate/web-components-core` — public surface. See SPEC.md. */

// Reactive input model
export type { AttrReader, Converter, InputDef, Reactivity } from './inputs/types.js';
export {
  toBool,
  toBytes,
  toCustom,
  toEnum,
  toFloat,
  toFunction,
  toInt,
  toList,
  toText,
} from './inputs/converters.js';
export type { EnumConverter } from './inputs/converters.js';
export { resolveFromAttribute, resolveFromProperty } from './inputs/apply.js';
export type { Resolved } from './inputs/apply.js';

// Reactive element base
export { BlissElement } from './element/bliss-element.js';
export { dispatch } from './element/dispatch.js';
export type { DispatchOptions } from './element/dispatch.js';
export { define } from './element/define.js';

// Generic DOM utilities
export { resolveEnumAttribute } from './dom/resolve-enum-attribute.js';
export { createMicrotaskScheduler } from './dom/microtask-scheduler.js';
export type { MicrotaskScheduler } from './dom/microtask-scheduler.js';
