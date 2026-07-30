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
export { defaultEventProperty, normalizeEventDefs } from './element/events.js';
export type { EventDef, EventMap, NormalizedEventDef } from './element/events.js';
export { define } from './element/define.js';

// Global registration (window.components) + live-instance registry (SPEC §12.3)
export { registerComponent } from './global/register-component.js';
export type {
  ComponentConfig,
  ComponentLoggingControls,
  RegisteredComponent,
  RegisterComponentOptions,
} from './global/register-component.js';
export { getInstances, getRegisteredTags } from './global/instances.js';

// Generic DOM utilities
export { resolveEnumAttribute } from './dom/resolve-enum-attribute.js';
export { createMicrotaskScheduler } from './dom/microtask-scheduler.js';
export type { MicrotaskScheduler } from './dom/microtask-scheduler.js';

// Logging (SPEC §12.1)
export { createLoggers, DEFAULT_CATEGORIES, DEFAULT_ENABLED_LEVEL } from './logging/create-loggers.js';
export type { LoggerBundle, Logger, LogLevelDesc, InstanceLogger } from './logging/create-loggers.js';
export { createPerfLogger } from './logging/perf-logger.js';
export type { PerfLogger } from './logging/perf-logger.js';
