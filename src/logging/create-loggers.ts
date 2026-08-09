/**
 * Categorized named loggers over the vendored {@link ./log-core} engine. One
 * call per component produces a `NAMESPACE:CATEGORY` logger per category, each
 * with a color-coded `%c` prefix (SPEC §12.1). Colour is applied via the
 * engine's `methodFactory` so the `%c` directive and its CSS argument are
 * ordered correctly — the message arguments stay uncoloured and structured-
 * loggable.
 *
 * The logging engine is vendored (no `loglevel` dependency) — see log-core.ts
 * for why. Consumers depend only on the {@link Logger} / {@link LogLevelDesc}
 * surface below, never on the engine internals.
 */
import { levels, getLogger, type LogLevelDesc, type CoreLogger } from './log-core.js';

/**
 * The public logger surface: the five level methods plus level control.
 * Deliberately lean — it does NOT expose engine internals (`methodFactory`,
 * `levels`, `enableAll`, …), so nothing downstream binds to the vendored
 * implementation. The concrete {@link CoreLogger} structurally satisfies it.
 */
export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setLevel(level: LogLevelDesc, persist?: boolean): void;
  getLevel(): number;
}

export type { LogLevelDesc };

/** Baseline categories. A component uses these as-is, redefines, or extends them. */
export const DEFAULT_CATEGORIES = ['INIT', 'DATA', 'UI'] as const;

/** Level `enableLogging()` applies when called with no argument. */
export const DEFAULT_ENABLED_LEVEL: LogLevelDesc = 'debug';

/** Stable palette; categories are coloured by their index (cycled). */
const PALETTE = [
  '#4c8bf5', // blue
  '#2ea043', // green
  '#d29922', // amber
  '#a371f7', // purple
  '#db61a2', // pink
  '#e5534b', // red
  '#3fb0ac', // teal
  '#8a6d3b', // brown
] as const;

const PREFIXED = new WeakSet<CoreLogger>();

/** Wrap a logger's methodFactory to emit `%c[NAMESPACE:CATEGORY]` + CSS, then the raw args. Idempotent. */
function applyColorPrefix(logger: CoreLogger, label: string, color: string): void {
  if (PREFIXED.has(logger)) return;
  PREFIXED.add(logger);
  const original = logger.methodFactory;
  const css = `color:${color};font-weight:bold`;
  logger.methodFactory = (methodName, level, loggerName) => {
    const raw = original(methodName, level, loggerName);
    return (...args: unknown[]) => raw(`%c[${label}]`, css, ...args);
  };
  // Re-apply the new factory to the already-bound level methods (no persistence write).
  logger.setLevel(logger.getLevel(), false);
}

/**
 * An instance-scoped logger (SPEC §12.3): the same five level methods as a
 * `loglevel` logger, but every line is prefixed with an instance id and gated by
 * the MOST verbose of the type-level category level and the instance's own
 * override. It emits via `console` directly (not through `loglevel`'s level
 * gate), so an instance can log while its type stays silent — the mechanism
 * behind "enable logging for THIS element" in a devtools overlay.
 */
export interface InstanceLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Category metadata captured so {@link LoggerBundle.forInstance} can match colors/labels. */
interface CategoryMeta {
  label: string;
  color: string;
  logger: CoreLogger;
}

/** Resolve a level descriptor (name or number) to its numeric value. */
function toLevelNum(desc: LogLevelDesc): number {
  if (typeof desc === 'number') return desc;
  return levels[desc.toUpperCase() as keyof typeof levels] ?? levels.SILENT;
}

/** [method, its level, the `console` method to emit through]. `trace` uses `debug` to avoid stack spam. */
const INSTANCE_METHODS: readonly [keyof InstanceLogger, number, 'debug' | 'info' | 'warn' | 'error'][] = [
  ['trace', levels.TRACE, 'debug'],
  ['debug', levels.DEBUG, 'debug'],
  ['info', levels.INFO, 'info'],
  ['warn', levels.WARN, 'warn'],
  ['error', levels.ERROR, 'error'],
];

function makeInstanceLogger(meta: CategoryMeta, instanceId: string, getOverride: () => LogLevelDesc | undefined): InstanceLogger {
  const css = `color:${meta.color};font-weight:bold`;
  const idCss = 'color:#888';
  const out = {} as Record<keyof InstanceLogger, (...args: unknown[]) => void>;
  for (const [name, methodLevel, consoleMethod] of INSTANCE_METHODS) {
    out[name] = (...args: unknown[]): void => {
      const override = getOverride();
      // Effective threshold = the more verbose (lower) of type level and override.
      const effective = Math.min(meta.logger.getLevel(), override == null ? levels.SILENT : toLevelNum(override));
      if (methodLevel < effective) return;
      const emit = (console[consoleMethod] ?? console.log).bind(console);
      emit(`%c[${meta.label}]%c ${instanceId}`, css, idCss, ...args);
    };
  }
  return out as InstanceLogger;
}

export interface LoggerBundle<C extends string> {
  /** One logger per category, keyed by category name. */
  loggers: Record<C, Logger>;
  /** Turn logging on across all categories (default level: `debug`). */
  enableLogging(level?: LogLevelDesc): void;
  /** Silence all categories. */
  disableLogging(): void;
  /** Set the same level on every category. */
  setLogLevel(level: LogLevelDesc): void;
  /** Set the level of one category. */
  setCategoryLevel(category: C, level: LogLevelDesc): void;
  /**
   * Build instance-scoped loggers (one per category) for a single element.
   * `instanceId` prefixes each line; `getOverrideLevel` is read on every call,
   * so toggling an instance's level takes effect live. Used by `BlissElement`.
   */
  forInstance(instanceId: string, getOverrideLevel: () => LogLevelDesc | undefined): Record<C, InstanceLogger>;
  /** The category list this bundle was built with. */
  readonly LOGGING_CATEGORIES: readonly C[];
}

/**
 * Build a bundle of colored, categorized loggers for `namespace`.
 *
 * ```ts
 * const { loggers } = createLoggers('MULTISELECT');                          // INIT/DATA/UI
 * const { loggers } = createLoggers('TREEVIEW', ['INIT','DATA','INDEX']);    // redefine
 * const { loggers } = createLoggers('DROPZONE', [...DEFAULT_CATEGORIES, 'FILE']); // extend
 * export const { INIT: initLogger, DATA: dataLogger, UI: uiLogger } = loggers;
 * ```
 */
export function createLoggers(namespace: string): LoggerBundle<(typeof DEFAULT_CATEGORIES)[number]>;
export function createLoggers<const C extends string>(namespace: string, categories: readonly C[]): LoggerBundle<C>;
export function createLoggers<C extends string>(
  namespace: string,
  categories: readonly C[] = DEFAULT_CATEGORIES as readonly string[] as readonly C[],
): LoggerBundle<C> {
  const loggers = {} as Record<C, Logger>;
  const meta = {} as Record<C, CategoryMeta>;

  categories.forEach((category, i) => {
    const label = `${namespace}:${category}`;
    const color = PALETTE[i % PALETTE.length]!;
    const logger = getLogger(label);
    applyColorPrefix(logger, label, color);
    loggers[category] = logger;
    meta[category] = { label, color, logger };
  });

  const setAll = (level: LogLevelDesc): void => {
    for (const category of categories) loggers[category].setLevel(level, false);
  };

  return {
    loggers,
    LOGGING_CATEGORIES: categories,
    enableLogging(level: LogLevelDesc = DEFAULT_ENABLED_LEVEL) {
      setAll(level);
    },
    disableLogging() {
      setAll('silent');
    },
    setLogLevel(level: LogLevelDesc) {
      setAll(level);
    },
    setCategoryLevel(category: C, level: LogLevelDesc) {
      loggers[category]?.setLevel(level, false);
    },
    forInstance(instanceId: string, getOverrideLevel: () => LogLevelDesc | undefined) {
      const result = {} as Record<C, InstanceLogger>;
      for (const category of categories) {
        result[category] = makeInstanceLogger(meta[category], instanceId, getOverrideLevel);
      }
      return result;
    },
  };
}
