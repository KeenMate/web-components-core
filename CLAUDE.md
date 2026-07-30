# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: core v1 implemented

The `@keenmate/web-components-core` package (inputs model + `BlissElement`) is
built under `src/` with full unit tests. **`SPEC.md` remains the source of
truth** for design intent — read the relevant section before changing behavior,
and keep it in sync. §11 open questions resolved so far: config key field is
`configKey` (§11.2); the string converter is `toText` (§11.1); `applyConfig`
is split into `reinit()` + `update(partial)` hooks (§11.3, see below). §11.4
(store/satellite) stays dropzone-local for now.

### Commands

```
npm test            # vitest run (jsdom) — the whole suite
npm run test:watch  # vitest watch mode
npx vitest run src/inputs/converters.test.ts   # a single test file
npx vitest run -t "toEnum"                      # tests matching a name
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/ (ESM + .d.ts), excludes *.test.ts
```

Note: `esbuild`'s postinstall may be blocked by the sandbox on `npm install`;
if vitest can't start, run `npm approve-scripts esbuild` (or reinstall
unsandboxed). Tests run in jsdom (`vitest.config.ts`); `*.test.ts` files live
next to the code they cover. Source uses explicit `.js` extensions on relative
imports (moduleResolution `Bundler`) and `verbatimModuleSyntax` (type-only
imports must use `import type`).

Runtime dependencies: **`loglevel`** only (for the logging module, below). The
positioning module of §12.2 (which would add `@floating-ui/dom`) is not built —
don't add it without confirming shape.

## Why this package exists

Five shipping KeenMate web components (`web-multiselect`,
`web-daterangepicker`, `web-treeview`, `web-dropzone`, `web-grid`) each
re-implement the same custom-element plumbing and have drifted into four
different "attribute table" dialects plus private copies of the base wiring.
Core consolidates that into one reactive input model and one base class. See
§1 and §7 of the spec for the per-component divergence and fit check.

## Core architecture (v1)

Two load-bearing concepts. Understanding both requires reading §4–§6 of the spec.

1. **One reactive input table.** Every public input — attribute, complex
   property, or callback — is a single `InputDef` row (`configKey`, optional
   kebab `attribute`, `converter`, `default`, `on` reactivity, `reflect`).
   There is **no central switch statement**: dispatch is
   `def.converter.fromAttribute(raw)`. A new input type is a new converter
   created anywhere (core or a component) — never a core edit or a closed union.

2. **The `Converter<V>` owns both parsing and validation.** One converter per
   input handles the attribute path (`fromAttribute`: raw string → validated
   `V`) *and* the property path (`validate`: is this JS-assigned value
   acceptable?), plus optional reflection (`toAttribute`). Correctness lives in
   one place so it can't drift across the three spots it used to. The `to*`
   factory library (`toEnum`, `toInt`, `toFloat`, `toText`, `toBool`,
   `toBytes`, `toList`, `toCustom`, `toFunction`) sets both paths from the same
   inputs. Note: `toText` (not `toString` — avoids the `Object.prototype`
   collision).

3. **`BlissElement` base class** wires both entry points through the *same*
   pipeline (parse/validate → stage → dispatch per `on`), so everything is
   reactive by construction. It is SSR-safe via the
   `typeof HTMLElement !== 'undefined'` stub, computes `observedAttributes`
   from the input table, coalesces bursts (`setAttributes()` / `batch()` /
   microtask), and provides typed event `dispatch()`. The input table is
   **opt-in**: `web-grid` extends `BlissElement` for the SSR base + `dispatch`
   only and keeps its config-object API.

   A coalesced batch drives one of two subclass hooks (both no-op by default):
   - **`reinit()`** — full rebuild; called on first connect and whenever the
     batch changes any `on: 'reinit'` input. Reads `this.config` (already
     merged); given no partial, because a rebuild absorbs any `update` keys
     that changed in the same batch.
   - **`update(partial)`** — in-place patch with just the changed `on: 'update'`
     keys; called only when the batch has NO reinit-level change.

   This resolves SPEC §11.3: reinit dominates update in a mixed batch, so the
   update partial is suppressed when a rebuild will happen anyway.

## Key invariants (enforce these in review and when migrating components)

- Web components build **on** core — do not re-implement observed-attribute,
  parse, or dispatch plumbing in a component.
- Reactivity is declared per input (`on: 'update' | 'reinit' | 'none'`) and
  enforced centrally. No input can be added that forgets to parse, validate, or
  react.
- Docs/IntelliSense are **secondary** and fed from JSDoc comments (BlissFramework
  C-CEM-13 format), *not* from the parser structure. Converter introspection
  (e.g. `toEnum(...).values`) is optional and nothing depends on it.
- Migration is one PR per component, behind that component's existing tests,
  with **no consumer-facing attribute/event changes**. Order: build core →
  treeview → multiselect + dropzone → daterangepicker → web-grid (§9).

## Logging (`src/logging/`, SPEC §12.1 — implemented)

`createLoggers(namespace, categories?)` returns categorized `NAMESPACE:CATEGORY`
loggers over **`loglevel`** (core's one runtime dependency), each with a
color-coded `%c` prefix done in a `methodFactory` (ordering-safe:
`%c[label]` + CSS, then raw args — messages stay uncoloured). Categories default
to `INIT/DATA/UI` and can be redefined or extended. `enableLogging()` defaults to
`debug`; `disableLogging()` → silent. `createPerfLogger(namespace)` is the opt-in
timing companion. `loglevel-plugin-prefix` was **dropped** (its browser `%c`
handling is the ordering bug we avoid) — an amendment to §12.1's original text.

Note: `BlissElement`'s input-validation warnings deliberately bypass this logger
and call `console.warn` directly, so they surface even when logging is disabled.

## Beyond v1

§12 tracks further shared modules not yet built — positioning wrappers over
`@floating-ui/dom` (§12.2), CEM tooling, theming helpers. These are **not** in
scope; don't build them without confirming the shape. Decisions are recorded in
§11 (resolved) and §12.1 (logger, done).
