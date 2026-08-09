/**
 * Minimal categorized-logging engine — a trimmed TypeScript/ESM port of
 * `loglevel` (https://github.com/pimterry/loglevel, MIT © 2013 Tim Perry,
 * v1.9.2), vendored so this package carries **no external logging dependency**.
 *
 * Why vendor instead of depending on the npm package: `loglevel` is a CommonJS
 * module that puts its whole API on `module.exports`. `import * as log from
 * 'loglevel'` then relies on CJS→ESM interop to surface `log.levels` etc.; a
 * bundler resolves that at build time, but Node's native ESM loader (i.e. every
 * consumer's vitest run) leaves `log.levels` `undefined` → `log.levels.TRACE`
 * throws at module-eval. Owning the ~150 lines removes both the dependency and
 * that hazard, and it's authored as native ESM so no interop is involved.
 *
 * What's preserved from loglevel: named loggers, per-level gating, and — the
 * point of the library — the *bind the real console method* trick, so devtools
 * still reports YOUR call site's line number (a naive
 * `(...a) => console.debug(...a)` wrapper reports this file instead).
 *
 * What's dropped: the IE `trace` shim, the deferred-console handling, the cookie
 * persistence fallback, `noConflict`, and the UMD wrapper. Persistence is
 * localStorage-only, under a configurable key prefix (see
 * {@link setLogPersistKeyPrefix}).
 */

/** Level names, most→least verbose. */
export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
/** A level given as a name (either case) or its numeric rank (0..5). */
export type LogLevelDesc = LogLevelName | Uppercase<LogLevelName> | number;

/** Numeric ranks — identical to loglevel, ordered by console verbosity. */
export const levels = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    SILENT: 5,
} as const;

/** The five console-backed methods, in rank order. */
const LOG_METHODS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
type LogMethodName = (typeof LOG_METHODS)[number];

type LogFn = (...args: unknown[]) => void;

/**
 * Builds the concrete emit function for one method at the resolved level.
 * Reassignable per logger — this is the hook the color-prefix wrapper in
 * `create-loggers.ts` uses to inject the `%c[NAMESPACE:CATEGORY]` label.
 */
export type MethodFactory = (
    methodName: LogMethodName,
    level: number,
    loggerName: string | undefined,
) => LogFn;

/** The engine's full logger surface (superset of the public {@link Logger}). */
export interface CoreLogger {
    readonly name: string | undefined;
    readonly levels: typeof levels;
    methodFactory: MethodFactory;
    trace: LogFn;
    debug: LogFn;
    info: LogFn;
    warn: LogFn;
    error: LogFn;
    log: LogFn;
    getLevel(): number;
    setLevel(level: LogLevelDesc, persist?: boolean): void;
    setDefaultLevel(level: LogLevelDesc): void;
    resetLevel(): void;
    enableAll(persist?: boolean): void;
    disableAll(persist?: boolean): void;
    rebuild(): void;
}

const noop: LogFn = () => {};

// ── persistence key ──────────────────────────────────────────────────────────

let persistKeyPrefix = 'km-log';

/**
 * Configure the localStorage key prefix used to persist per-logger levels.
 * Keys are `${prefix}:${loggerName}` (e.g. `km-log:DROPZONE:UI`). Default is
 * `km-log` — namespaced and unambiguous, unlike loglevel's bare `loglevel` key.
 * Call before levels are persisted (typically at app startup) to take effect.
 */
export function setLogPersistKeyPrefix(prefix: string): void {
    persistKeyPrefix = prefix;
}

/** Current localStorage key prefix (see {@link setLogPersistKeyPrefix}). */
export function getLogPersistKeyPrefix(): string {
    return persistKeyPrefix;
}

// ── console binding (line-number-preserving) ─────────────────────────────────

/** Bind a console method to `console` so the browser keeps the call-site line. */
function bindMethod(methodName: string): LogFn {
    const c = console as unknown as Record<string, unknown>;
    const method = c[methodName];
    return typeof method === 'function' ? (method.bind(console) as LogFn) : noop;
}

/**
 * Pick the best real console method to BIND (not wrap) for `methodName`.
 * `debug` maps to `console.log` (matching loglevel); everything else uses its
 * namesake when present, falling back to `console.log`, then to noop.
 */
function realMethod(methodName: string): LogFn {
    if (methodName === 'debug') methodName = 'log';
    if (typeof console === 'undefined') return noop;
    const c = console as unknown as Record<string, unknown>;
    if (c[methodName] !== undefined) return bindMethod(methodName);
    if (c.log !== undefined) return bindMethod('log');
    return noop;
}

const defaultMethodFactory: MethodFactory = (methodName) => realMethod(methodName);

/** Coerce a name/number level descriptor to its numeric rank, or throw. */
function normalizeLevel(input: LogLevelDesc): number {
    let level: LogLevelDesc = input;
    const table = levels as Record<string, number>;
    if (typeof level === 'string' && table[level.toUpperCase()] !== undefined) {
        level = table[level.toUpperCase()]!;
    }
    if (typeof level === 'number' && level >= 0 && level <= levels.SILENT) {
        return level;
    }
    throw new TypeError(`setLevel() called with an invalid level: ${String(input)}`);
}

// ── logger ───────────────────────────────────────────────────────────────────

/** The shared root logger — assigned below; referenced during child init. */
let root: LoggerImpl | undefined;
const byName: Record<string, CoreLogger> = {};

class LoggerImpl implements CoreLogger {
    readonly name: string | undefined;
    readonly levels = levels;
    methodFactory: MethodFactory;

    // Installed by replaceLoggingMethods(); definite-assignment via `!`.
    trace!: LogFn;
    debug!: LogFn;
    info!: LogFn;
    warn!: LogFn;
    error!: LogFn;
    log!: LogFn;

    /** Level inherited from the root (cached so it stays in sync with installed methods). */
    private inheritedLevel: number;
    /** Optional per-logger default; overrides inherited. */
    private defaultLevel: number | null = null;
    /** Optional user-set level; overrides default. */
    private userLevel: number | null = null;

    constructor(name: string | undefined, factory: MethodFactory) {
        this.name = name;
        this.methodFactory = factory;
        this.inheritedLevel = normalizeLevel(root ? root.getLevel() : 'WARN');
        // getPersistedLevel() only returns a validated level name (or undefined).
        const persisted = this.getPersistedLevel();
        if (persisted != null) this.userLevel = normalizeLevel(persisted as LogLevelDesc);
        this.replaceLoggingMethods();
    }

    private storageKey(): string | undefined {
        return typeof this.name === 'string' ? `${persistKeyPrefix}:${this.name}` : undefined;
    }

    private persist(levelNum: number): void {
        const key = this.storageKey();
        if (typeof window === 'undefined' || !key) return;
        const levelName = (LOG_METHODS[levelNum] ?? 'silent').toUpperCase();
        try {
            window.localStorage[key] = levelName;
        } catch {
            /* storage unavailable / quota — persistence is best-effort */
        }
    }

    private getPersistedLevel(): string | undefined {
        const key = this.storageKey();
        if (typeof window === 'undefined' || !key) return undefined;
        let stored: string | undefined;
        try {
            stored = window.localStorage[key];
        } catch {
            /* storage unavailable */
        }
        // Ignore anything that isn't a known level name.
        if (stored === undefined || (levels as Record<string, number>)[stored] === undefined) {
            return undefined;
        }
        return stored;
    }

    private clearPersisted(): void {
        const key = this.storageKey();
        if (typeof window === 'undefined' || !key) return;
        try {
            window.localStorage.removeItem(key);
        } catch {
            /* storage unavailable */
        }
    }

    private replaceLoggingMethods(): void {
        const level = this.getLevel();
        LOG_METHODS.forEach((methodName, i) => {
            this[methodName] = i < level ? noop : this.methodFactory(methodName, level, this.name);
        });
        this.log = this.debug;
    }

    getLevel(): number {
        if (this.userLevel != null) return this.userLevel;
        if (this.defaultLevel != null) return this.defaultLevel;
        return this.inheritedLevel;
    }

    setLevel(level: LogLevelDesc, persist?: boolean): void {
        this.userLevel = normalizeLevel(level);
        if (persist !== false) this.persist(this.userLevel);
        this.replaceLoggingMethods();
    }

    setDefaultLevel(level: LogLevelDesc): void {
        this.defaultLevel = normalizeLevel(level);
        if (!this.getPersistedLevel()) this.setLevel(level, false);
    }

    resetLevel(): void {
        this.userLevel = null;
        this.clearPersisted();
        this.replaceLoggingMethods();
    }

    enableAll(persist?: boolean): void {
        this.setLevel(levels.TRACE, persist);
    }

    disableAll(persist?: boolean): void {
        this.setLevel(levels.SILENT, persist);
    }

    rebuild(): void {
        if (root && root !== this) {
            this.inheritedLevel = normalizeLevel(root.getLevel());
        }
        this.replaceLoggingMethods();
        if (root === this) {
            for (const childName in byName) byName[childName]!.rebuild();
        }
    }
}

root = new LoggerImpl(undefined, defaultMethodFactory);

/** The shared root logger (level inherited by named loggers). */
export function getRootLogger(): CoreLogger {
    return root!;
}

/**
 * Get (or lazily create) the shared named logger for `name`. Named loggers are
 * memoized, so two calls with the same name return the same instance — that's
 * what lets a second `createLoggers('NS')` reuse the first's loggers.
 */
export function getLogger(name: string): CoreLogger {
    if (typeof name !== 'string' || name === '') {
        throw new TypeError('You must supply a non-empty name when creating a logger.');
    }
    let logger = byName[name];
    if (!logger) {
        logger = byName[name] = new LoggerImpl(name, root!.methodFactory);
    }
    return logger;
}
