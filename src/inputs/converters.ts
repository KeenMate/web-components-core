/**
 * The `to*` converter factories. Each returns a {@link Converter} that wires
 * `fromAttribute` (parse) and `validate` (property guard) from the same inputs,
 * so both entry points enforce identical correctness. See SPEC.md §5.
 *
 * A brand-new input type is just a new factory created anywhere (core or a
 * component) — there is no closed union and no central switch to edit.
 */
import type { Converter } from './types.js';

/** A {@link Converter} that also exposes its permitted values (optional docs autodetect, SPEC.md §8). */
export interface EnumConverter<V extends string> extends Converter<V> {
  readonly values: readonly V[];
}

/**
 * Exact-match against a fixed set of strings.
 *
 * Invalid or absent values fall back to `default` — or to `null` when
 * `nullOnInvalid` is set.
 */
export function toEnum<const T extends readonly string[]>(
  values: T,
  opts: { default?: T[number]; nullOnInvalid?: boolean } = {},
): EnumConverter<T[number]> {
  const set = new Set<string>(values);
  const fallback = (opts.nullOnInvalid ? null : opts.default ?? null) as T[number];
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
 * `allowEmpty` is set.
 */
export function toText(opts: { trim?: boolean; allowEmpty?: boolean; default?: string } = {}): Converter<string> {
  const fallback = opts.default ?? '';
  const normalize = (s: string): string => (opts.trim ? s.trim() : s);
  return {
    fromAttribute(raw) {
      if (raw === null) return fallback;
      const s = normalize(raw);
      return !opts.allowEmpty && s === '' ? fallback : s;
    },
    validate(value): value is string {
      return typeof value === 'string' && (opts.allowEmpty === true || value !== '');
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
 * `count` validation. A malformed item, or a length mismatch, falls back to
 * `default`.
 */
export function toList<E extends string | number = string>(opts: {
  of?: 'string' | 'int';
  sep?: string;
  count?: number;
  trim?: boolean;
  default?: E[];
} = {}): Converter<E[]> {
  const sep = opts.sep ?? ',';
  const of = opts.of ?? 'string';
  const fallback = opts.default ?? [];
  const parse = (raw: string): E[] | null => {
    const parts = raw.split(sep).map((p) => (opts.trim === false ? p : p.trim()));
    let items: (string | number)[] = parts;
    if (of === 'int') {
      items = parts.map((p) => Number.parseInt(p, 10));
      if (items.some((n) => Number.isNaN(n as number))) return null;
    }
    if (opts.count != null && items.length !== opts.count) return null;
    return items as E[];
  };
  return {
    fromAttribute(raw) {
      if (raw === null || raw === '') return fallback;
      return parse(raw) ?? fallback;
    },
    validate(value): value is E[] {
      if (!Array.isArray(value)) return false;
      if (opts.count != null && value.length !== opts.count) return false;
      const ok = of === 'int' ? (v: unknown) => typeof v === 'number' && Number.isInteger(v) : (v: unknown) => typeof v === 'string';
      return value.every(ok);
    },
    toAttribute(value) {
      return Array.isArray(value) ? value.join(sep) : null;
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

/** Callback input: property-only (no attribute), accepts any function. */
export function toFunction<F extends (...args: never[]) => unknown = (...args: never[]) => unknown>(): Converter<F> {
  return {
    validate(value): value is F {
      return typeof value === 'function';
    },
  };
}
