/**
 * The `to*` converter factories. Each returns a {@link Converter} that wires
 * `fromAttribute` (parse) and `validate` (property guard) from the same inputs,
 * so both entry points enforce identical correctness. See docs/SPEC.md §5.
 *
 * A brand-new input type is just a new factory created anywhere (core or a
 * component) — there is no closed union and no central switch to edit.
 */
import type { Converter } from './types.js';

/** A {@link Converter} that also exposes its permitted values (optional docs autodetect, docs/SPEC.md §8). */
export interface EnumConverter<V extends string> extends Converter<V> {
  readonly values: readonly V[];
}

/**
 * Exact-match against a fixed set of strings.
 *
 * Invalid or absent values fall back to `default` — or to `null` when
 * `shouldNullOnInvalid` is set.
 */
export function toEnum<const T extends readonly string[]>(
  values: T,
  opts: { default?: T[number]; shouldNullOnInvalid?: boolean } = {},
): EnumConverter<T[number]> {
  const set = new Set<string>(values);
  const fallback = (opts.shouldNullOnInvalid ? null : opts.default ?? null) as T[number];
  return {
    values,
    fromAttribute(raw) {
      if (raw === null) return (opts.default ?? fallback) as T[number];
      return set.has(raw) ? (raw as T[number]) : fallback;
    },
    validate(value): value is T[number] {
      return typeof value === 'string' && set.has(value);
    },
    toAttribute(value) {
      return value == null ? null : String(value);
    },
  };
}

/** Parse a base-10 integer with optional range check; `NaN` / out-of-range → `default`. */
export function toInt(opts: { min?: number; max?: number; default?: number } = {}): Converter<number> {
  const inRange = (n: number): boolean =>
    (opts.min == null || n >= opts.min) && (opts.max == null || n <= opts.max);
  const fallback = opts.default as number;
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      const n = Number.parseInt(raw, 10);
      return Number.isNaN(n) || !inRange(n) ? fallback : n;
    },
    validate(value): value is number {
      return typeof value === 'number' && Number.isInteger(value) && inRange(value);
    },
    toAttribute(value) {
      return value == null ? null : String(value);
    },
  };
}

/** Parse a floating-point number with optional range check; `NaN` / out-of-range → `default`. */
export function toFloat(opts: { min?: number; max?: number; default?: number } = {}): Converter<number> {
  const inRange = (n: number): boolean =>
    (opts.min == null || n >= opts.min) && (opts.max == null || n <= opts.max);
  const fallback = opts.default as number;
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      const n = Number.parseFloat(raw);
      return Number.isNaN(n) || !inRange(n) ? fallback : n;
    },
    validate(value): value is number {
      return typeof value === 'number' && Number.isFinite(value) && inRange(value);
    },
    toAttribute(value) {
      return value == null ? null : String(value);
    },
  };
}

/**
 * String input. Named `toText` — NOT `toString` — to avoid colliding with
 * `Object.prototype.toString`. Empty strings fall back to `default` unless
 * `isEmptyAllowed` is set.
 *
 * With `isNullable: true` the "unset" value is `null` instead of `''` — an
 * absent or empty attribute resolves to `null`, so callers can distinguish
 * "not set" from "set to empty" (an optional string). `null` is the same
 * absent-sentinel `toEnum`'s `shouldNullOnInvalid` uses. To clear a nullable
 * input via the property path, assign `null` (assigning `''` is still rejected,
 * like non-nullable). `isEmptyAllowed` and `isNullable` are orthogonal: the
 * former keeps `''` as a value; the latter sets the unset sentinel to `null`.
 */
export function toText(opts?: { shouldTrim?: boolean; isEmptyAllowed?: boolean; default?: string }): Converter<string>;
export function toText(opts: { shouldTrim?: boolean; isEmptyAllowed?: boolean; isNullable: true; default?: string | null }): Converter<string | null>;
export function toText(
  opts: { shouldTrim?: boolean; isEmptyAllowed?: boolean; isNullable?: boolean; default?: string | null } = {},
): Converter<string | null> {
  const isNullable = opts.isNullable === true;
  const fallback = opts.default ?? (isNullable ? null : '');
  const normalize = (s: string): string => (opts.shouldTrim ? s.trim() : s);
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      const s = normalize(raw);
      return !opts.isEmptyAllowed && s === '' ? fallback : s;
    },
    validate(value): value is string | null {
      if (value === null) return isNullable;
      return typeof value === 'string' && (opts.isEmptyAllowed === true || value !== '');
    },
    toAttribute(value) {
      return value == null ? null : String(value);
    },
  };
}

const TRUEISH = new Set(['', 'true', '1', 'yes', 'on']);
const FALSEISH = new Set(['false', '0', 'no', 'off']);

/**
 * Boolean attribute, per mode:
 *
 * - `presence`      — present (any value) → `true`, absent → `false`.
 * - `default-true`  — absent → `true`; explicit `"false"`/`"0"`/… → `false`.
 * - `default-false` — absent → `false`; explicit `"true"`/`"1"`/… → `true`.
 * - `tristate`      — absent → `null`; otherwise `true` / `false`.
 */
export function toBool(mode: 'presence' | 'default-true' | 'default-false' | 'tristate' = 'presence'): Converter<boolean | null> {
  const parse = (raw: string): boolean | null => {
    const v = raw.trim().toLowerCase();
    if (TRUEISH.has(v)) return true;
    if (FALSEISH.has(v)) return false;
    return null;
  };
  return {
    fromAttribute(raw) {
      switch (mode) {
        case 'presence':
          return raw !== null;
        case 'default-true':
          return raw === null ? true : parse(raw) ?? true;
        case 'default-false':
          return raw === null ? false : parse(raw) ?? false;
        case 'tristate':
          return raw === null ? null : parse(raw);
      }
    },
    validate(value): value is boolean | null {
      if (mode === 'tristate') return value === true || value === false || value === null;
      return typeof value === 'boolean';
    },
    toAttribute(value) {
      if (mode === 'presence') return value ? '' : null;
      return value == null ? null : String(value);
    },
  };
}

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/** Parse a human byte size (`"10mb"` → `10485760`); unrecognized → `default`. */
export function toBytes(opts: { default?: number } = {}): Converter<number> {
  const fallback = opts.default as number;
  const parse = (raw: string): number | null => {
    const m = /^\s*([\d.]+)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(raw);
    if (!m) return null;
    const n = Number.parseFloat(m[1]!);
    if (Number.isNaN(n)) return null;
    return Math.round(n * BYTE_UNITS[(m[2] ?? 'b').toLowerCase()]!);
  };
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      return parse(raw) ?? fallback;
    },
    validate(value): value is number {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    },
    toAttribute(value) {
      return value == null ? null : String(value);
    },
  };
}

/**
 * Delimited list (CSV / pipe-list) of strings or ints, with optional exact
 * `requiredCount` validation. A malformed item, or a length mismatch, falls
 * back to `default`.
 */
export function toList<E extends string | number = string>(opts: {
  itemType?: 'string' | 'int';
  separator?: string;
  requiredCount?: number;
  shouldTrim?: boolean;
  default?: E[];
} = {}): Converter<E[]> {
  const separator = opts.separator ?? ',';
  const itemType = opts.itemType ?? 'string';
  const fallback = opts.default ?? [];
  const parse = (raw: string): E[] | null => {
    const parts = raw.split(separator).map((p) => (opts.shouldTrim === false ? p : p.trim()));
    let items: (string | number)[] = parts;
    if (itemType === 'int') {
      items = parts.map((p) => Number.parseInt(p, 10));
      if (items.some((n) => Number.isNaN(n as number))) return null;
    }
    if (opts.requiredCount != null && items.length !== opts.requiredCount) return null;
    return items as E[];
  };
  return {
    fromAttribute(raw) {
      if (raw === null || raw === '') return fallback;
      return parse(raw) ?? fallback;
    },
    validate(value): value is E[] {
      if (!Array.isArray(value)) return false;
      if (opts.requiredCount != null && value.length !== opts.requiredCount) return false;
      const ok = itemType === 'int' ? (v: unknown) => typeof v === 'number' && Number.isInteger(v) : (v: unknown) => typeof v === 'string';
      return value.every(ok);
    },
    toAttribute(value) {
      return Array.isArray(value) ? value.join(separator) : null;
    },
  };
}

/**
 * Rich value of arbitrary shape — the property-first analogue of {@link toText}
 * /{@link toInt} for data too complex for a plain scalar. The PROPERTY path
 * accepts any value (or one that passes `validate`); the ATTRIBUTE path (only if
 * the input declares an `attribute`) parses the raw string as JSON, falling back
 * to `default` on malformed JSON or a value that fails `validate`. Reflects back
 * as JSON. For arrays/objects specifically, prefer {@link toObjectArray} /
 * {@link toObject}, which bake in the shape check.
 */
export function toValue<V = unknown>(
  opts: { validate?: (value: unknown) => value is V; default?: V } = {},
): Converter<V> {
  const fallback = opts.default as V;
  return {
    fromAttribute(raw) {
      if (raw === null || raw.trim() === '') return fallback;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fallback;
      }
      if (opts.validate && !opts.validate(parsed)) return fallback;
      return parsed as V;
    },
    validate: opts.validate,
    toAttribute(value) {
      return value == null ? null : JSON.stringify(value);
    },
  };
}

/**
 * Array of rich items (e.g. an `options` data array). The property path requires
 * an array — each item optionally checked by `validateItem`; the attribute path
 * parses JSON. Absent / blank / malformed / wrong-shape → `default` (default
 * `[]`). Reflects as JSON. This is the core home for the property-only rich-array
 * pattern components used to hand-write.
 */
export function toObjectArray<E = unknown>(
  opts: { validateItem?: (item: unknown) => item is E; default?: E[] } = {},
): Converter<E[]> {
  const fallback = opts.default ?? [];
  const isValid = (value: unknown): value is E[] =>
    Array.isArray(value) && (!opts.validateItem || value.every(opts.validateItem));
  return {
    fromAttribute(raw) {
      if (raw === null || raw.trim() === '') return fallback;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fallback;
      }
      return isValid(parsed) ? parsed : fallback;
    },
    validate: isValid,
    toAttribute(value) {
      return Array.isArray(value) ? JSON.stringify(value) : null;
    },
  };
}

/**
 * Plain object (a config map, etc.). The property path requires a non-null,
 * NON-array object (optionally checked by `validate`); the attribute path parses
 * JSON. Absent / blank / malformed / wrong-shape → `default` (default
 * `undefined` — objects rarely have a natural empty sentinel; pass `{}` if you
 * want one). Reflects as JSON.
 */
export function toObject<V extends object = Record<string, unknown>>(
  opts: { validate?: (value: unknown) => value is V; default?: V } = {},
): Converter<V> {
  const fallback = opts.default as V;
  const isValid = (value: unknown): value is V =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && (!opts.validate || opts.validate(value));
  return {
    fromAttribute(raw) {
      if (raw === null || raw.trim() === '') return fallback;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fallback;
      }
      return isValid(parsed) ? parsed : fallback;
    },
    validate: isValid,
    toAttribute(value) {
      return value == null ? null : JSON.stringify(value);
    },
  };
}

/**
 * Wrap a bespoke parser (month-names, `'auto' | 0..6`, …). Supply an optional
 * `validate` / `toAttribute` when the input also travels the property or
 * reflection paths; without `validate`, property assignments pass through.
 */
export function toCustom<V>(
  parse: (raw: string | null) => V,
  opts: { validate?: (value: unknown) => value is V; toAttribute?: (value: V) => string | null } = {},
): Converter<V> {
  return {
    fromAttribute(raw) {
      return parse(raw);
    },
    validate: opts.validate,
    toAttribute: opts.toAttribute,
  };
}

/**
 * Callback input: property-only (no attribute), accepts any function — or `null`
 * / `undefined` to CLEAR it. Callbacks are inherently optional, and clearing one
 * by assignment (`el.onThing = null`, exactly like a DOM event-handler property)
 * must be accepted, not rejected. So the value type is `F | null`; give the row a
 * `default` of `null` if you want an explicit unset sentinel.
 */
export function toFunction<F extends (...args: never[]) => unknown = (...args: never[]) => unknown>(): Converter<F | null> {
  return {
    validate(value): value is F | null {
      return value === null || value === undefined || typeof value === 'function';
    },
  };
}
