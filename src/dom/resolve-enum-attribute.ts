/**
 * Read an enum attribute value against a set, with a fallback (lifted from
 * dropzone). A generic DOM helper for the cases that don't go through the
 * input table; the {@link import('../inputs/converters.js').toEnum} converter
 * is preferred for table-driven inputs.
 */
export function resolveEnumAttribute<T extends string>(
  raw: string | null,
  values: readonly T[],
  fallback: T,
  opts: { caseInsensitive?: boolean } = {},
): T {
  if (raw === null) return fallback;
  if (opts.caseInsensitive) {
    const lower = raw.toLowerCase();
    return values.find((v) => v.toLowerCase() === lower) ?? fallback;
  }
  return (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
