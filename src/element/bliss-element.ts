/**
 * `BlissElement` — the reactive base class. SSR-safe (the `typeof HTMLElement`
 * stub every repo used to copy), it wires attributes AND properties through the
 * one {@link resolveFromAttribute}/{@link resolveFromProperty} pipeline, folds
 * bursts into a single {@link reinit}/{@link update}, and reflects when asked.
 * The input table is OPT-IN: a subclass without `static inputs` still gets the
 * SSR base plus
 * `dispatch`/`define` (web-grid's use). See SPEC.md §6.
 */
import { resolveFromAttribute, resolveFromProperty, type Resolved } from '../inputs/apply.js';
import type { AttrReader, InputDef } from '../inputs/types.js';
import { createMicrotaskScheduler, type MicrotaskScheduler } from '../dom/microtask-scheduler.js';

const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown)) as typeof HTMLElement;

export abstract class BlissElement extends Base {
  /** The opt-in input table. Subclasses set this to enable attribute/property reactivity. */
  protected static inputs?: readonly InputDef[];

  static get observedAttributes(): string[] {
    return (this.inputs ?? []).filter((d) => d.attribute).map((d) => d.attribute!);
  }

  readonly #config: Record<string, unknown> = {};
  readonly #byConfigKey = new Map<string, InputDef>();
  readonly #byAttribute = new Map<string, InputDef>();
  readonly #scheduler: MicrotaskScheduler = createMicrotaskScheduler();
  readonly #boundFlush = (): void => this.#flush();
  #pending: Record<string, unknown> | null = null;
  #pendingReinit = false;
  #connectedOnce = false;
  #reflecting = false;

  constructor() {
    super();
    const defs = (this.constructor as typeof BlissElement).inputs ?? [];
    for (const def of defs) {
      this.#byConfigKey.set(def.configKey, def);
      if (def.attribute) this.#byAttribute.set(def.attribute, def);
    }
    this.#seedDefaults(defs);
    this.#installAccessors(defs);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void {
    if (this.#reflecting) return;
    const def = this.#byAttribute.get(name);
    if (!def) return;
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
    if (!this.#connectedOnce) {
      this.#connectedOnce = true;
      // First connect is always a full build — there is nothing to patch yet.
      this.#pendingReinit = true;
    }
    this.#flushNow();
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

  // ── subclass surface ─────────────────────────────────────────────────────

  /** The current validated config. */
  protected get config(): Readonly<Record<string, unknown>> {
    return this.#config;
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
      if (had) (this as Record<string, unknown>)[key] = pre;
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
  }
}
