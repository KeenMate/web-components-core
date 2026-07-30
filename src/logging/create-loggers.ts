/**
 * Categorized named loggers over `loglevel`. One call per component produces a
 * `NAMESPACE:CATEGORY` logger per category, each with a color-coded `%c` prefix
 * (SPEC §12.1). Colour is applied via a `loglevel` `methodFactory` so the `%c`
 * directive and its CSS argument are ordered correctly — the message arguments
 * stay uncoloured and structured-loggable. `loglevel-plugin-prefix` is
 * deliberately not used (its browser `%c` handling is the bug this avoids).
 */
import * as log from 'loglevel';

type Logger = log.Logger;
type LogLevelDesc = log.LogLevelDesc;

export type { Logger, LogLevelDesc };

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

const PREFIXED = new WeakSet<Logger>();

/** Wrap a logger's methodFactory to emit `%c[NAMESPACE:CATEGORY]` + CSS, then the raw args. Idempotent. */
function applyColorPrefix(logger: Logger, label: string, color: string): void {
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

  categories.forEach((category, i) => {
    const logger = log.getLogger(`${namespace}:${category}`);
    applyColorPrefix(logger, `${namespace}:${category}`, PALETTE[i % PALETTE.length]!);
    loggers[category] = logger;
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
  };
}
