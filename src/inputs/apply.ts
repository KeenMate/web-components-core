/**
 * The parse + validate + stage pipeline shared by BOTH entry points. Attributes
 * go through {@link resolveFromAttribute}, JS-assigned properties through
 * {@link resolveFromProperty}, and both produce the same {@link Resolved} shape
 * — so everything is reactive by construction. See docs/SPEC.md §6.
 */
import type { AttrReader, InputDef, Reactivity } from './types.js';

/** A single input resolved from either entry point, ready to stage. */
export interface Resolved {
  configKey: string;
  field?: string;
  value: unknown;
  on: Reactivity;
}

/** Attribute path: `converter.fromAttribute(raw)` → resolved value (converter supplies its own fallback). */
export function resolveFromAttribute(def: InputDef, raw: string | null, reader: AttrReader): Resolved {
  const conv = def.converter;
  const value = conv?.fromAttribute
    ? conv.fromAttribute(raw, reader, def.attribute ?? def.configKey)
    : raw ?? def.default;
  return { configKey: def.configKey, field: def.field, value, on: def.on ?? 'update' };
}

/**
 * Property path: `converter.validate(value)` → resolved value, or `null` when
 * the value is rejected. A converter without `validate` accepts any value.
 */
export function resolveFromProperty(def: InputDef, value: unknown): Resolved | null {
  const conv = def.converter;
  if (conv?.validate && !conv.validate(value)) return null;
  return { configKey: def.configKey, field: def.field, value, on: def.on ?? 'update' };
}
