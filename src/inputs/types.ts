/**
 * The reactive input model. Every public input — attribute, complex property,
 * or callback — is one {@link InputDef} row whose {@link Converter} owns both
 * parsing (attribute path) and validation (property path). See SPEC.md §4.
 */

/** The subset of an element the attribute path reads. */
export interface AttrReader {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * What a change to an input triggers.
 *
 * - `update`  — apply the new value in place (default).
 * - `reinit`  — the value requires a full rebuild.
 * - `none`    — store the value only; do not react.
 */
export type Reactivity = 'update' | 'reinit' | 'none';

/**
 * Turns an incoming value into a correct, typed value. One converter per input
 * owns BOTH entry points, so a JS-assigned property is validated against the
 * same rules an attribute string is parsed by — correctness can't drift.
 */
export interface Converter<V> {
  /** Attribute path: raw string (`null` when absent/removed) → validated `V` (or fallback). */
  fromAttribute?(raw: string | null, el: AttrReader, attr: string): V;
  /** Property path: is this JS-assigned value acceptable? (callbacks, arrays, objects). */
  validate?(value: unknown): value is V;
  /** Optional reflect `V` → attribute string (`null` removes the attribute). */
  toAttribute?(value: V): string | null;
}

/** One public input: how to name it, parse/validate it, its default, and what a change triggers. */
export interface InputDef<V = unknown> {
  /** Config option key, e.g. `'selectionMode'` / `'getBadgeDisplayCallback'`. */
  configKey: string;
  /** Kebab attribute name; OMIT for property-only inputs (callbacks, rich objects). */
  attribute?: string;
  /** Optional private backing field to also set, e.g. `'_treeId'` (treeview pattern). */
  field?: string;
  /** How to parse (attribute) and validate (property). */
  converter?: Converter<V>;
  /** Value used when the attribute is absent / no property has been assigned. */
  default?: V;
  /** What a change triggers. Default `'update'`. */
  on?: Reactivity;
  /** Reflect property → attribute on assignment? Requires `attribute` + `converter.toAttribute`. */
  reflect?: boolean;
  /**
   * Human description for docs / editor IntelliSense (the CEM tooling reads it —
   * SPEC §12.4). The table already carries the STRUCTURE (name, type, default);
   * this is the "extra help text" only a person can write. Ignored at runtime.
   */
  description?: string;
  /** Doc metadata: mark this input deprecated (`true`) or with a reason string. Ignored at runtime. */
  deprecated?: boolean | string;
}
