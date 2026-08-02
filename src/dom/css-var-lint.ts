/**
 * CSS custom-property lint helpers (SPEC §12.8 — the third leg alongside
 * {@link adoptStyles} / {@link createStyleSlot}). A `customStylesCallback` (or any
 * injected CSS) that *sets* a `--prefix-*` variable the component's stylesheet
 * never *reads* fails silently — the property just resolves to nothing. These
 * pure helpers let a component warn about such a misspelled/renamed variable
 * (e.g. `--ms-badge-text-background` where the real one is `--ms-badge-text-bg`).
 *
 * Pure + bundler-agnostic on purpose: there is NO dev-mode gating and NO
 * `console` here. The consumer decides *when* to run this (typically under its
 * bundler's dev flag, so it is stripped from production) and *how* to report —
 * consistent with core staying render- and bundler-agnostic.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every `--prefix-*` custom property a CSS string *reads* via `var(--prefix-…)`. */
export function extractConsumedCssVars(css: string, prefix: string): Set<string> {
  const found = new Set<string>();
  const re = new RegExp(`var\\(\\s*(${escapeRegExp(prefix)}[a-z0-9-]+)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) if (m[1]) found.add(m[1]);
  return found;
}

/** Every `--prefix-*` custom property a CSS string *declares* (`--prefix-foo: …`), de-duped. */
export function declaredCssVars(css: string, prefix: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(`(${escapeRegExp(prefix)}[a-z0-9-]+)\\s*:`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) if (m[1]) found.add(m[1]);
  return [...found];
}

/**
 * Known variables sharing the most `-`-separated tokens with `name` — the likely
 * intended target of a typo. Defaults require ≥3 shared tokens (a single-token
 * prefix like `ms`/`drp` plus two path segments) to stay quiet, and return at
 * most 3, best first. Tune `minScore` for multi-token prefixes.
 */
export function suggestCssVars(
  name: string,
  known: Iterable<string>,
  opts: { minScore?: number; limit?: number } = {},
): string[] {
  const minScore = opts.minScore ?? 3;
  const limit = opts.limit ?? 3;
  const tokens = new Set(name.split('-').filter(Boolean));
  return [...known]
    .map((k) => ({ k, score: k.split('-').filter((t) => tokens.has(t)).length }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.k);
}

/** One lint finding: a declared `--prefix-*` variable nothing consumes. */
export interface CssVarFinding {
  /** The declared variable that has no reader. */
  name: string;
  /** Closest real variables it might be a typo of (may be empty). */
  suggestions: string[];
}

/**
 * Lint `css`: report every `--prefix-*` variable it *declares* that is not in
 * `consumed` (the set the component's own stylesheet actually reads), each with
 * typo suggestions drawn from `consumed`. Returns `[]` when `consumed` is empty
 * — no ground truth means nothing to check (e.g. the stylesheet wasn't inlined).
 */
export function lintCssVars(
  css: string,
  opts: { prefix: string; consumed: Set<string>; minScore?: number },
): CssVarFinding[] {
  if (opts.consumed.size === 0) return [];
  const findings: CssVarFinding[] = [];
  for (const name of declaredCssVars(css, opts.prefix)) {
    if (opts.consumed.has(name)) continue;
    findings.push({ name, suggestions: suggestCssVars(name, opts.consumed, { minScore: opts.minScore }) });
  }
  return findings;
}
