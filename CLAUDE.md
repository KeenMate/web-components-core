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

Runtime dependencies: **`loglevel`** (logging) and **`@floating-ui/dom`** (the
`/positioning` module, §12.2). `@floating-ui/dom` is imported only under
`src/positioning/`, so it stays out of the base import graph — components that
don't position pull only `loglevel`.

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

   **Lifecycle (build-once + activate/deactivate, Lit's model).** Two more
   opt-in hooks manage *live* resources separately from structure:
   - **`connect()`** — every connect, after any `reinit()`/`update()`. Start
     listeners, observers, floating-ui `autoUpdate`, timers.
   - **`disconnect()`** — every disconnect. Stop what `connect()` started.

   A DOM move (reorder/re-parent) fires `disconnect()`→`connect()` and
   **re-activates without rebuilding** (`reinit()` runs only on first connect or
   an `on:'reinit'` change) — so transient UI state survives. `connect()`/
   `disconnect()` can run many times; keep them balanced. Config changed while
   detached is held and applied on reconnect, before `connect()`.

## Key invariants (enforce these in review and when migrating components)

- Web components build **on** core — do not re-implement observed-attribute,
  parse, or dispatch plumbing in a component.
- Reactivity is declared per input (`on: 'update' | 'reinit' | 'none'`) and
  enforced centrally. No input can be added that forgets to parse, validate, or
  react.
- The `static inputs` table is sanity-checked once per class at construction
  (`console.warn`, never throws): duplicate `configKey`/`attribute`, or
  `reflect: true` without an `attribute` / without `converter.toAttribute`. Watch
  the console when authoring a table.
- Removing an attribute is reactive: it resets that input to its `default`
  (absent == default), consistent with construction.
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

## CEM tooling (`src/cem/`, SPEC §12.6 — implemented)

`@keenmate/web-components-core/cem` is a **build-time-only** subpath (no runtime
dependency — the analyzer injects `typescript`). `blissInputsPlugin()` teaches
`@custom-elements-manifest/analyzer` to read the `static inputs` / `static
events` tables (invisible to the stock analyzer). All extraction is in the pure,
unit-tested `extractBlissClass(ts, node, sourceFile)`; the plugin is a thin
analyze-then-`moduleLinkPhase`-merge wrapper. `blissAnalyzerConfig()` is the
shared config preset. The plugin also recognizes core's `registerComponent()`
(via `parseRegisterComponentCall` / `extractRegistrations`) as a custom-element
definition — the stock analyzer only knows `customElements.define()` — so it sets
`customElement`/`tagName` and adds the `custom-element-definition` export.
`toEnum` types resolve through `as const` and shared members-consts (e.g. a
hoisted `const PLACEMENTS = […] as const`), not just inline array literals.
**Source-of-truth split (SPEC §8 amendment):** the table +
converter give the *structure* (attr↔prop, type, default, `reflect`, enum
members); the optional `description`/`deprecated` fields on each `InputDef` /
`EventDef` row (or a leading comment) give the *prose*. Those doc fields are
ignored at runtime. Keep `static inputs`/`static events` as literals (or a
hoisted `const … as const`) — the extractor reads AST literals, not runtime
values. Rich prose goes in `description` as a **template literal** (multi-line
markdown, bullet lists — preserved verbatim; the leading-comment fallback
flattens to one line, so use the field for structured text, and no `${}`
interpolation or the AST reader skips it). `InputDef.type` (a string) overrides
the converter-derived manifest type — the escape hatch for precise callback
signatures / generics that `toFunction()` (always `Function`) can't express. Note
the type is inferred from the converter *call name*, so a local wrapper (e.g.
`const cb = () => toFunction()`) defeats inference — use `type` there.

## Testing utilities (`src/testing/` + `whenSettled()`, SPEC §12.7 — implemented)

`BlissElement.whenSettled(): Promise<void>` (in **core**, not just tests)
resolves after the pending flush's `reinit()`/`update()` runs — immediately when
nothing is pending, after the microtask for loose assignments, already-settled
after `setAttributes()`/`batch()`, on next connect for detached changes. It's the
deterministic read-after-write signal. Its synchronous sibling is `flush()` —
applies pending writes *now* (runs `reinit()`/`update()` before returning), the
escape hatch for **imperative methods**: call `this.flush()` at the top of a
method that reads/mutates live state so `el.prop = x; el.method()` keeps working
when `prop` coalesced on a microtask (no `await` in between).
`@keenmate/web-components-core/testing` is a separate subpath of runner-agnostic
DOM fixtures (pure DOM, **zero deps**): `mount`/`cleanup`, `mountBeforeUpgrade`
(pre-upgrade capture), `uniqueTag`/`defineOnce`, `nextTick`/`nextFrame`, and
`listen()` → `EventSpy`. Playwright/a11y-contrast fixtures are **deferred** (out
of the input-model core).

## Positioning (`src/positioning/`, SPEC §12.2 — implemented)

`@keenmate/web-components-core/positioning` is a subpath over one pinned
`@floating-ui/dom`. `anchor(floating, reference, opts)` is the low-level
primitive (`'fixed'` default; `offset→size→flip→shift` middleware;
`matchWidth: 'min'|'exact'`; `lockPlacement` → `true` = `flip({ fallbackStrategy:
'initialPlacement' })`, `'freeze'` = flip once then pin the resolved placement;
`beforeCompute` per-frame hook (publish reference width to a CSS var / clamp
before measuring); `data-theme` inheritance for portaled layers per C-CS-10;
optional `platform` escape hatch) returning `{ update, destroy }`.
`createTooltip()` (hover/focus + delay + `followCursor` via `VirtualElement`;
`onBeforeShow` to dismiss an overlapping tooltip; `ShadowRoot` container for
shadow-scoped tooltip CSS/vars) and `createPopover()` (portaled dropdown/panel,
width-match, placement lock) are thin wrappers. Decisions: follow-cursor is a
tooltip option not a preset; the bespoke shadow-DOM platform was NOT ported (1.8
handles it + the `platform` hatch — a component with a genuinely custom platform,
like web-multiselect's narrowed fixed-position containing-block heuristic, passes
it via that hatch). Tests mock `@floating-ui/dom` (jsdom has no layout).

## Style injection (`src/dom/adopt-styles.ts`, SPEC §12.8 — implemented)

Two zero-dep free functions in the main index (core stays render-agnostic — no
shadow-DOM assumptions in `BlissElement`, so these are NOT methods).
`adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (cached
`CSSStyleSheet` per string, shared across instances, `<style>` fallback,
SSR-safe, dedup per root) — the `main.css?inline` case. `createStyleSlot(root, {
position?, className? })` → `{ set, clear, destroy }` is a per-instance
replaceable `<style>` slot for the `customStylesCallback` case (consistent
position so re-set replaces; `<style>`-based so user `@import` works). Authoring
rules (`@layer` order, `?inline`) stay CSS-guideline, not code.

## Beyond v1

§12 is fully built out. Decisions are recorded in §11 (resolved), §12.1 (logger),
§12.2 (positioning), §12.3 (global registration), §12.5 (events), §12.6 (CEM),
§12.7 (testing), §12.8 (style injection). No §12 candidates remain unbuilt; the
theming work reduced to the two §12.8 runtime helpers plus pure CSS-guideline
authoring rules. Don't add further shared modules without confirming the shape.
