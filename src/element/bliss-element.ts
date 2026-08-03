/**
 * `BlissElement` — the reactive base class. SSR-safe (the `typeof HTMLElement`
 * stub every repo used to copy), it wires attributes AND properties through the
 * one {@link resolveFromAttribute}/{@link resolveFromProperty} pipeline, folds
 * bursts into a single {@link reinit}/{@link update}, and reflects when asked.
 * Lifecycle follows a build-once + activate/deactivate model: {@link reinit}
 * builds structure (first connect + `on:'reinit'` changes), while
 * {@link connect}/{@link disconnect} start and stop live resources on every
 * connect/disconnect — a plain DOM move re-activates without rebuilding.
 * The input table is OPT-IN: a subclass without `static inputs` still gets the
 * SSR base plus
 * `dispatch`/`define` (web-grid's use). See docs/SPEC.md §6.
 */
import { resolveFromAttribute, resolveFromProperty, type Resolved } from '../inputs/apply.js';
import type { AttrReader, InputDef } from '../inputs/types.js';
import { createMicrotaskScheduler, type MicrotaskScheduler } from '../dom/microtask-scheduler.js';
import { trackInstance, untrackInstance } from '../global/instances.js';
import { getLoggerBundle } from '../logging/logger-registry.js';
import type { InstanceLogger, LogLevelDesc } from '../logging/create-loggers.js';
import { dispatch, type DispatchOptions } from './dispatch.js';
import {
  normalizeEventDefs,
  type EventDef,
  type EventMap,
  type NormalizedEventDef,
} from './events.js';

const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

/** Constructors whose input table has already been sanity-checked (once per class). */
const VALIDATED = new WeakSet<object>();

/** Monotonic per-element counter, purely for a readable `tag#n` log id. */
let INSTANCE_SEQ = 0;

/** One shared no-op logger for components whose tag has no attached bundle. */
const NOOP_LOGGER: InstanceLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const NOOP_LOGGERS: Record<string, InstanceLogger> = new Proxy(
  {},
  { get: () => NOOP_LOGGER },
) as Record<string, InstanceLogger>;

export abstract class BlissElement<TEvents extends EventMap = EventMap> extends Base {
  /** The opt-in input table. Subclasses set this to enable attribute/property reactivity. */
  protected static inputs?: readonly InputDef[];

  /**
   * The opt-in event table (SPEC §12.5). Each entry (a bare name, or an
   * {@link EventDef} for overrides) declares an outward notification that
   * {@link emit} can fire and installs a managed `on<Name>` handler property.
   */
  protected static events?: readonly (string | EventDef)[];

  static get observedAttributes(): string[] {
    return (this.inputs ?? []).filter((d) => d.attribute).map((d) => d.attribute!);
  }

  readonly #config: Record<string, unknown> = {};
  readonly #byConfigKey = new Map<string, InputDef>();
  readonly #byAttribute = new Map<string, InputDef>();
  readonly #eventsByName = new Map<string, NormalizedEventDef>();
  /** Live handler currently bound via each managed `on<Name>` property, keyed by event name. */
  readonly #eventHandlers = new Map<string, EventListener>();
  readonly #scheduler: MicrotaskScheduler = createMicrotaskScheduler();
  readonly #boundFlush = (): void => this.#flush();
  #pending: Record<string, unknown> | null = null;
  #pendingReinit = false;
  #settleResolvers: Array<() => void> = [];
  #connectedOnce = false;
  /**
   * configKeys that carried a value assigned BEFORE the element was upgraded
   * (`el.foo = …` before its class was defined). The browser fires the initial
   * `attributeChangedCallback`s AFTER the constructor, so without this an initial
   * attribute would clobber that lifted property. We let the pre-upgrade property
   * win over the *initial* attribute (the conventional lazy-property-upgrade
   * guarantee); post-connect attribute changes react normally. Cleared on first
   * connect.
   */
  #preUpgradeKeys: Set<string> | null = null;
  #reflecting = false;
  #internals?: ElementInternals;
  #logId?: string;
  #logLevel?: LogLevelDesc;
  #instanceLoggers?: Record<string, InstanceLogger>;

  constructor() {
    super();
    const ctor = this.constructor as typeof BlissElement;
    const defs = ctor.inputs ?? [];
    const events = normalizeEventDefs(ctor.events);
    this.#validateOnce(defs, events);
    for (const def of defs) {
      this.#byConfigKey.set(def.configKey, def);
      if (def.attribute) this.#byAttribute.set(def.attribute, def);
    }
    for (const ev of events) this.#eventsByName.set(ev.name, ev);
    this.#seedDefaults(defs);
    this.#installAccessors(defs);
    this.#installEventAccessors(events);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void {
    if (this.#reflecting) return;
    const def = this.#byAttribute.get(name);
    if (!def) return;
    // A property assigned before upgrade wins over the initial attribute the
    // browser replays right after the constructor (see #preUpgradeKeys).
    if (!this.#connectedOnce && this.#preUpgradeKeys?.has(def.configKey)) return;
    let resolved: Resolved;
    try {
      resolved = resolveFromAttribute(def, raw, this as unknown as AttrReader);
    } catch (err) {
      this.#warn(`converter for "${def.configKey}" threw parsing attribute ${name}="${raw}"; using default`, err);
      resolved = this.#fallback(def);
    }
    this.#stage(resolved);
  }

  connectedCallback(): void {
    // Track the live instance for the window.components registry (SPEC §12.3),
    // before any build so a devtools overlay sees it even mid-reinit.
    trackInstance(this.localName, this);
    if (!this.#connectedOnce) {
      this.#connectedOnce = true;
      // The pre-upgrade window is over; the initial-attribute guard is no longer
      // needed and later setAttribute()s react normally.
      this.#preUpgradeKeys = null;
      // First connect is always a full build — there is nothing to patch yet.
      this.#pendingReinit = true;
    }
    this.#flushNow(); // reinit()/update() for any pending config, THEN activate
    this.connect();
  }

  disconnectedCallback(): void {
    untrackInstance(this.localName, this);
    this.disconnect();
  }

  // ── public batching API ─────────────────────────────────────────────────

  /** Apply many inputs (by `configKey` or attribute name) as ONE reinit/update. */
  setAttributes(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      const def = this.#byConfigKey.get(key) ?? this.#byAttribute.get(key);
      if (def) this.#setFromProperty(def, value);
    }
    this.#flushNow();
  }

  /** Run `fn` and coalesce every input change it makes into a single reinit/update. */
  batch(fn: () => void): void {
    fn();
    this.#flushNow();
  }

  /**
   * Apply any pending input writes **synchronously, now** — running the
   * resulting `reinit()`/`update()` before this call returns. No-op when nothing
   * is pending (or while detached, where changes are held until connect).
   *
   * This is the escape hatch for **imperative methods** that read or mutate live
   * state built from inputs. Loose property assignments coalesce on a microtask
   * (`el.options = …`), so a synchronous method called right after (e.g.
   * `el.setSelected(…)`) would otherwise run against pre-write state. Call
   * `this.flush()` at the top of such a method to preserve the intuitive
   * "set property, then call method" ordering without forcing consumers to
   * `await whenSettled()` between the two.
   */
  flush(): void {
    this.#flushNow();
  }

  /**
   * Resolves once the element is **settled** — i.e. every staged input change
   * has been applied and the resulting `reinit()`/`update()` has run. If nothing
   * is pending it resolves immediately (a microtask); otherwise it resolves at
   * the end of the next flush. This is the deterministic "await the pipeline"
   * signal for tests AND consumers — read rendered state right after it, instead
   * of guessing with a bare `await Promise.resolve()`.
   *
   * Note: loose property assignments coalesce on a microtask, so
   * `el.x = …; await el.whenSettled()` awaits that microtask. `setAttributes()`
   * and `batch()` flush synchronously, so after either the element is already
   * settled. While the element is **detached**, pending changes are held (the
   * flush no-ops until connected), so the promise resolves on the next connect's
   * flush — not before the change is actually applied.
   */
  whenSettled(): Promise<void> {
    if (!this.#pending && !this.#pendingReinit) return Promise.resolve();
    return new Promise<void>((resolve) => this.#settleResolvers.push(resolve));
  }

  // ── subclass surface ─────────────────────────────────────────────────────

  /** The current validated config. */
  protected get config(): Readonly<Record<string, unknown>> {
    return this.#config;
  }

  /**
   * Instance-scoped loggers, one per category of the bundle this component
   * registered (via `registerComponent`'s `logging` option). Each line is
   * prefixed with a `tag#id` handle — the element's own `id` when set, else a
   * `tag#n` counter — and gated by the more verbose of the type-level category
   * level and this instance's own override, so a devtools overlay can make ONE
   * element loud while its type stays quiet (SPEC §12.3). Returns no-op loggers
   * when the tag has no attached bundle. Prefer this over the shared type-level
   * loggers inside a component.
   */
  protected get log(): Record<string, InstanceLogger> {
    if (this.#instanceLoggers) return this.#instanceLoggers;
    const bundle = getLoggerBundle(this.localName);
    if (!bundle) return NOOP_LOGGERS; // not memoized: a later registration can still take effect
    // Prefer the element's id (readable in an overlay); fall back to a counter.
    const id = (this.#logId ??= `${this.localName}#${this.id || ++INSTANCE_SEQ}`);
    return (this.#instanceLoggers = bundle.forInstance(id, () => this.#logLevel));
  }

  /**
   * Turn on verbose logging for THIS element only (default `debug`), independent
   * of the type-level level. The seam a Ctrl-Alt-C overlay calls after the user
   * picks one instance. Pairs with {@link disableLogging}.
   */
  enableLogging(level: LogLevelDesc = 'debug'): void {
    this.#logLevel = level;
  }

  /** Clear this element's logging override (falls back to the type-level level). */
  disableLogging(): void {
    this.#logLevel = undefined;
  }

  /** Whether this element has an active logging override (not unset/`silent`). */
  get isLoggingEnabled(): boolean {
    return this.#logLevel != null && this.#logLevel !== 'silent' && this.#logLevel !== 5;
  }

  /**
   * Full rebuild: called when a batch changes any `on: 'reinit'` input, and on
   * first connect. Reads {@link config} (already fully merged) — it is not given
   * a partial, because any `on: 'update'` keys that changed in the same batch
   * are absorbed by the rebuild. Override in components that need it; no-op by
   * default so the input table stays opt-in.
   */
  protected reinit(): void {
    /* opt-in */
  }

  /**
   * In-place patch: called with just the changed `on: 'update'` keys, when a
   * batch contains NO reinit-level change. Override to apply the named keys
   * without a teardown; no-op by default.
   */
  protected update(_partial: Record<string, unknown>): void {
    /* opt-in */
  }

  /**
   * Activate: called on EVERY connect, after any `reinit()`/`update()` for that
   * connect (including the first). Start live resources here — document/window
   * listeners, observers, floating-ui `autoUpdate`, timers. Pairs with
   * {@link disconnect} and can run many times (any DOM move re-fires it), so
   * keep it balanced/idempotent. No-op by default.
   */
  protected connect(): void {
    /* opt-in */
  }

  /**
   * Deactivate: called on EVERY disconnect. Stop whatever {@link connect}
   * started. The shadow DOM persists across disconnect/reconnect, so do NOT
   * tear down structure here — only the live resources. No-op by default.
   */
  protected disconnect(): void {
    /* opt-in */
  }

  // ── form association ──────────────────────────────────────────────────────

  /**
   * This element's {@link ElementInternals}, lazily attached on first access and
   * memoized. Available to form-associated components (`static formAssociated =
   * true`); returns `null` when `attachInternals` is unavailable (SSR, older
   * jsdom) or the element opts out. Because `attachInternals()` may be called at
   * most once per element, a subclass must NOT call it itself — read this getter
   * instead (e.g. `this.internals?.setFormValue(value)`).
   */
  protected get internals(): ElementInternals | null {
    if (this.#internals) return this.#internals;
    if (typeof this.attachInternals !== 'function') return null;
    try {
      return (this.#internals = this.attachInternals());
    } catch {
      // attachInternals throws if internals were already attached elsewhere or
      // the feature is disabled; degrade to null rather than break construction.
      return null;
    }
  }

  /**
   * The `<form>` this element is associated with, or `null`. A form-associated
   * custom element (`static formAssociated = true`) participates in its form, but
   * — unlike a native control — gets NO `.form` property for free: the browser
   * records the association only inside {@link ElementInternals}. This re-exposes
   * it so `el.form` and `event.target.form` resolve like a native input. Host
   * frameworks that route form changes by reading `target.form` (e.g. Phoenix
   * LiveView's `phx-change` delegation) depend on it. Unlike `closest('form')`,
   * `ElementInternals.form` honours shadow-DOM boundaries and `form=` association.
   */
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }

  // ── events & callbacks (SPEC §12.5) ───────────────────────────────────────

  /**
   * Fire an outward notification: dispatch a typed `CustomEvent`. `name` and
   * `detail` are checked against the component's event map (`static events`),
   * and per-event dispatch overrides from the table are applied (defaulting to
   * the {@link dispatch} defaults: bubbles + composed). Returns `false` when a
   * cancelable event was `preventDefault()`-ed. The paired `on<Name>` property
   * (if declared) is a real listener, so it fires through the normal dispatch —
   * `emit` does not call it separately.
   */
  protected emit<K extends keyof TEvents & string>(
    name: K,
    detail?: TEvents[K],
    opts?: DispatchOptions,
  ): boolean {
    const def = this.#eventsByName.get(name);
    return dispatch(this, name, detail, {
      bubbles: opts?.bubbles ?? def?.bubbles,
      composed: opts?.composed ?? def?.composed,
      cancelable: opts?.cancelable ?? def?.cancelable,
    });
  }

  /**
   * Typed `addEventListener` for a declared event: the handler receives a
   * `CustomEvent<detail>`. Returns an unsubscribe function. Complements the
   * managed `on<Name>` property with the same event object.
   */
  on<K extends keyof TEvents & string>(
    name: K,
    handler: (event: CustomEvent<TEvents[K]>) => void,
    options?: AddEventListenerOptions,
  ): () => void {
    const listener = handler as EventListener;
    this.addEventListener(name, listener, options);
    return () => this.removeEventListener(name, listener, options);
  }

  /**
   * Invoke a `*Callback` input through the one unified protocol (SPEC §12.5):
   * unset → `opts.whenUnset`; the callback is called with a single `ctx`
   * argument and its result is normalized through `Promise.resolve` (so sync OR
   * async callbacks both work); a throw routes to `opts.onError` if given, else
   * re-throws (no silent swallow). The RESULT contract — the discriminated
   * `action`, adjustments, etc. — is the component's; core owns only the
   * plumbing. Correctness that used to drift across per-component hook wrappers
   * lives here once.
   */
  protected async runHook<Ctx, R>(
    callbackKey: string,
    ctx: Ctx,
    opts: { whenUnset: R; onError?: (error: unknown) => R },
  ): Promise<R> {
    const fn = this.#config[callbackKey] as ((ctx: Ctx) => R | Promise<R>) | undefined;
    if (typeof fn !== 'function') return opts.whenUnset;
    try {
      return await Promise.resolve(fn(ctx));
    } catch (error) {
      if (opts.onError) return opts.onError(error);
      throw error;
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #seedDefaults(defs: readonly InputDef[]): void {
    for (const def of defs) {
      let value: unknown = def.default;
      if (def.converter?.fromAttribute) {
        try {
          value = def.converter.fromAttribute(null, this as unknown as AttrReader, def.attribute ?? def.configKey);
        } catch (err) {
          this.#warn(`converter for "${def.configKey}" threw computing its default; using \`default\``, err);
          value = def.default;
        }
      }
      this.#config[def.configKey] = value;
      if (def.field) (this as Record<string, unknown>)[def.field] = value;
    }
  }

  #fallback(def: InputDef): Resolved {
    return { configKey: def.configKey, field: def.field, value: def.default, on: def.on ?? 'update' };
  }

  /** Sanity-check the input + event tables once per class; warn (never throw) on mistakes. */
  #validateOnce(defs: readonly InputDef[], events: readonly NormalizedEventDef[]): void {
    const ctor = this.constructor as object;
    if (VALIDATED.has(ctor)) return;
    VALIDATED.add(ctor);

    const seenKeys = new Set<string>();
    const seenAttrs = new Set<string>();
    for (const def of defs) {
      if (seenKeys.has(def.configKey)) this.#warn(`invalid input table: duplicate configKey "${def.configKey}"`);
      seenKeys.add(def.configKey);

      if (def.attribute) {
        if (seenAttrs.has(def.attribute)) this.#warn(`invalid input table: duplicate attribute "${def.attribute}"`);
        seenAttrs.add(def.attribute);
      }

      if (def.reflect && !def.attribute) {
        this.#warn(`invalid input table: "${def.configKey}" has reflect:true but no attribute to reflect to`);
      }
      if (def.reflect && !def.converter?.toAttribute) {
        this.#warn(`invalid input table: "${def.configKey}" has reflect:true but its converter has no toAttribute`);
      }
    }

    const seenEvents = new Set<string>();
    for (const ev of events) {
      if (seenEvents.has(ev.name)) this.#warn(`invalid event table: duplicate event "${ev.name}"`);
      seenEvents.add(ev.name);

      // Convention: event names are lowercase kebab/bare (no `Callback` suffix).
      if (!/^[a-z][a-z0-9-]*$/.test(ev.name)) {
        this.#warn(`invalid event table: event "${ev.name}" should be lowercase kebab-case (e.g. "date-select")`);
      }
      // The managed `on<Name>` property must not collide with an input property.
      if (ev.property && seenKeys.has(ev.property)) {
        this.#warn(`invalid event table: event "${ev.name}" property "${ev.property}" collides with an input configKey`);
      }
    }
  }

  /**
   * Always-on console warning for input validation failures. Deliberately uses
   * `console.warn` directly — NOT the (future) categorized logger — so rejected
   * inputs surface even when logging is disabled.
   */
  #warn(message: string, ...detail: unknown[]): void {
    console.warn(`[BlissElement] <${this.localName ?? 'unknown'}> ${message}`, ...detail);
  }

  #installAccessors(defs: readonly InputDef[]): void {
    for (const def of defs) {
      const key = def.configKey;
      // Preserve a value assigned before upgrade, then route it through the setter.
      const had = Object.prototype.hasOwnProperty.call(this, key);
      const pre = had ? (this as Record<string, unknown>)[key] : undefined;
      if (had) delete (this as Record<string, unknown>)[key];
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        get: () => this.#config[key],
        set: (value: unknown) => this.#setFromProperty(def, value),
      });
      if (had) {
        // Remember it so the initial attribute can't clobber it (see attributeChangedCallback).
        (this.#preUpgradeKeys ??= new Set()).add(key);
        (this as Record<string, unknown>)[key] = pre;
      }
    }
  }

  /**
   * Install a managed `on<Name>` handler property per event. Assigning it
   * (de)registers a real listener for the event, so the property behaves like
   * `addEventListener(name, …)` and its handler receives the `CustomEvent`.
   */
  #installEventAccessors(events: readonly NormalizedEventDef[]): void {
    for (const ev of events) {
      const prop = ev.property;
      if (!prop) continue;
      const eventName = ev.name;
      // Preserve a handler assigned before upgrade, then route it through the setter.
      const had = Object.prototype.hasOwnProperty.call(this, prop);
      const pre = had ? (this as Record<string, unknown>)[prop] : undefined;
      if (had) delete (this as Record<string, unknown>)[prop];
      Object.defineProperty(this, prop, {
        configurable: true,
        enumerable: true,
        get: () => this.#eventHandlers.get(eventName) ?? null,
        set: (handler: unknown) => {
          const prev = this.#eventHandlers.get(eventName);
          if (prev) this.removeEventListener(eventName, prev);
          if (typeof handler === 'function') {
            const listener = handler as EventListener;
            this.#eventHandlers.set(eventName, listener);
            this.addEventListener(eventName, listener);
          } else {
            this.#eventHandlers.delete(eventName);
          }
        },
      });
      if (had) (this as Record<string, unknown>)[prop] = pre;
    }
  }

  #setFromProperty(def: InputDef, value: unknown): void {
    const resolved = resolveFromProperty(def, value);
    if (!resolved) {
      this.#warn(`rejected invalid value for property "${def.configKey}"; keeping previous value`, value);
      return;
    }
    this.#stage(resolved);
    if (def.reflect && def.attribute && def.converter?.toAttribute) {
      const attrVal = def.converter.toAttribute(resolved.value as never);
      this.#reflecting = true;
      try {
        if (attrVal === null) this.removeAttribute(def.attribute);
        else this.setAttribute(def.attribute, attrVal);
      } finally {
        this.#reflecting = false;
      }
    }
  }

  #stage(resolved: Resolved): void {
    this.#config[resolved.configKey] = resolved.value;
    if (resolved.field) (this as Record<string, unknown>)[resolved.field] = resolved.value;
    if (resolved.on === 'none') return; // store only
    if (resolved.on === 'reinit') this.#pendingReinit = true;
    (this.#pending ??= {})[resolved.configKey] = resolved.value;
    this.#scheduler.schedule(this.#boundFlush);
  }

  /** Cancel any queued microtask and flush pending changes synchronously now. */
  #flushNow(): void {
    this.#scheduler.cancel();
    this.#flush();
  }

  #flush(): void {
    if (!this.isConnected) return; // hold until connected
    const reinit = this.#pendingReinit;
    const partial = this.#pending;
    this.#pendingReinit = false;
    this.#pending = null;
    // A reinit rebuilds from full config, so it absorbs any update keys in the batch.
    if (reinit) this.reinit();
    else if (partial && Object.keys(partial).length > 0) this.update(partial);
    this.#resolveSettled();
  }

  /** Resolve everyone awaiting {@link whenSettled} for the flush that just ran. */
  #resolveSettled(): void {
    if (this.#settleResolvers.length === 0) return;
    const resolvers = this.#settleResolvers;
    this.#settleResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
