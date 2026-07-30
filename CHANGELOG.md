# Changelog

All notable changes to `@keenmate/web-components-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Reactive input model** (`src/inputs/`): `Converter` / `InputDef` types and
  the `to*` converter factories — `toEnum`, `toInt`, `toFloat`, `toText`,
  `toBool`, `toBytes`, `toList`, `toCustom`, `toFunction` — each owning both the
  attribute parse path and the property validate path from one definition.
- **`BlissElement`** base class (`src/element/`): SSR-safe, table-driven
  `observedAttributes`, attribute + property reactivity through one pipeline,
  coalesced batching (`setAttributes()`, `batch()`), optional attribute
  reflection, pre-upgrade property capture, and the `reinit()` / `update(partial)`
  subclass hooks (opt-in, no-op by default). The input table is opt-in.
- **Element lifecycle** (build-once + activate/deactivate, Lit's model): opt-in
  `connect()` / `disconnect()` hooks fire on every connect/disconnect for live
  resources (listeners, observers, floating-ui `autoUpdate`). A DOM move
  re-activates without rebuilding; `reinit()` runs only on first connect or an
  `on:'reinit'` change. Config changed while detached is applied on reconnect
  before `connect()`.
- Typed `dispatch()` (composed + bubbling by default) and idempotent, SSR-safe
  `define()`.
- DOM utilities (`src/dom/`): `resolveEnumAttribute`, `createMicrotaskScheduler`.
- **Always-on invalid-input warnings**: `BlissElement` emits `console.warn` for
  rejected property values and for converters that throw (falling back to the
  input's `default`). Deliberately bypasses the logger so it surfaces even when
  logging is disabled.
- **Dev-time input-table validation**: once per class, `BlissElement` warns (never
  throws) on a malformed `static inputs` table — duplicate `configKey`, duplicate
  `attribute`, `reflect: true` without an `attribute`, or `reflect: true` without
  `converter.toAttribute`.
- **Global registration** (`src/global/`, SPEC §12.3): `registerComponent(tag,
  elementClass, { config, logging?, shouldAutoDefine? })` publishes a component to
  the `window.components` global, defines the element (idempotently, auto by
  default), and flattens a `createLoggers()` bundle into the `logging` controls —
  replacing the block every shipping component copy-pasted (and drifted). Paired
  with a **live-instance registry**: `BlissElement` auto-tracks its connected
  instances per tag (add on connect / remove on disconnect; a DOM move re-tracks
  without duplicating), exposed via `getInstances(tag)` / the entry's
  `getInstances()` and `getRegisteredTags()`. The returned elements are the
  per-instance handles for a devtools overlay.
- **Per-instance logging** (SPEC §12.3): `BlissElement` exposes `this.log` — an
  instance logger per category of the tag's `createLoggers` bundle (wired by
  `registerComponent`'s `logging` option), each line prefixed with a `tag#id`
  handle (the element's `id` when set, else a `tag#n` counter) and gated by the
  more verbose of the type-level level and the instance's own
  override. `element.enableLogging(level?)` / `disableLogging()` /
  `isLoggingEnabled` toggle logging for ONE element while its type stays silent
  — the Ctrl-Alt-C overlay case. New `LoggerBundle.forInstance(id, getOverride)`
  factory and `InstanceLogger` type; components should prefer `this.log.<CAT>`
  over the shared type-level loggers.
- **Callbacks & events model** (`src/element/`, SPEC §12.5): one unified
  primitive for each of the two kinds the naming convention separates. **Events**
  — a `static events` table (bare name or `EventDef`), a typed `emit(name,
  detail)` (checked against `BlissElement<TEvents>`'s event map, per-event
  bubbles/composed overrides), and a managed `on<Name>` handler property
  (default `on` + PascalCase) that (de)registers a real listener so
  `el.onSelect = e => e.detail.option` equals `addEventListener('select', …)`
  and receives the `CustomEvent`; plus a typed `on(name, handler)` returning an
  unsubscribe. **`*Callback` hooks** — `runHook(key, ctx, { whenUnset, onError? })`
  owns the plumbing (unset→neutral, single-ctx arg, `Promise.resolve`
  normalization, rethrow-on-error unless `onError` supplied); the discriminated
  result contract stays per-component. Dev-time lint (warn-only) for duplicate /
  non-kebab event names and `on<Name>`↔input collisions. Event-name string
  standardization across components is deferred to each component's next major.
- **Logging** (`src/logging/`, SPEC §12.1): `createLoggers(namespace, categories?)`
  returns categorized `NAMESPACE:CATEGORY` loggers over `loglevel`, each with a
  color-coded `%c` prefix; `DEFAULT_CATEGORIES` (`INIT/DATA/UI`), redefinable and
  extendable; `enableLogging()` (defaults to `debug`) / `disableLogging()` /
  `setLogLevel()` / `setCategoryLevel()`. Plus the opt-in `createPerfLogger()`
  (`start`/`end`/`measure`/`summary`/`clear`).

- **Rich-data converters** (`src/inputs/converters.ts`, SPEC §5): `toValue`,
  `toObjectArray`, and `toObject` — the property-first analogue of `toFunction`
  for arrays/objects. The property path IS the shape check (`validate`), and a
  JSON attribute path applies when the input declares an `attribute` (malformed /
  wrong-shape → `default`; reflects as JSON). `toObjectArray` takes an optional
  per-item `validateItem` and defaults to `[]`; `toObject` requires a non-null,
  non-array object. Resolves the multiselect migration's gap #2 — the
  hand-written `toObjectArray()` moves into core.
- **`BlissElement.whenSettled()`** (SPEC §12.7): a first-class "await the
  reactive pipeline" signal. Resolves once every staged input change has flushed
  and its `reinit()`/`update()` has run (immediately when nothing is pending;
  after the coalescing microtask for loose property assignments; already-settled
  after `setAttributes()`/`batch()`; on the next connect for changes staged while
  detached). Deterministic read-after-write for tests and consumers alike.
- **Testing utilities** (`@keenmate/web-components-core/testing`, SPEC §12.7):
  runner-agnostic DOM fixtures (pure DOM, zero deps) — `mount(html|element)` with
  tracked `cleanup()`, `mountBeforeUpgrade()` for the pre-upgrade capture path,
  `uniqueTag()` / `defineOnce()`, `nextTick()` / `nextFrame()`, and
  `listen(target, type)` → an `EventSpy` for asserting §12.5 emits without a
  mocking library. Exposed as a separate subpath so it never enters the runtime
  bundle.
- **CEM tooling** (`@keenmate/web-components-core/cem`, SPEC §12.6): a
  `@custom-elements-manifest/analyzer` plugin (`blissInputsPlugin`) that reads the
  `static inputs` / `static events` tables so the manifest is generated from the
  single source of truth — structure from each row + its converter (attr↔prop,
  type, default, `reflect`, enum members), prose from optional `description` /
  `deprecated` fields on the row (or a leading comment). Ships with a shared
  analyzer config preset (`blissAnalyzerConfig`) and a pure, unit-tested extractor
  (`extractBlissClass`). Build-time only — no runtime dependency (the analyzer
  injects `typescript`).
- **`InputDef` / `EventDef` doc metadata**: optional `description` and
  `deprecated` fields, read by the CEM tooling and otherwise ignored at runtime.
- **Positioning** (`@keenmate/web-components-core/positioning`, SPEC §12.2): a
  floating-element positioning module over one pinned `@floating-ui/dom` (ends
  the 1.5/1.7 version drift across the five components). `anchor()` — the
  low-level primitive (`'fixed'` default, `offset→size→flip→shift` middleware,
  `matchWidth: 'min'|'exact'`, `lockPlacement`, `autoUpdate`, `data-theme`
  inheritance for portaled layers per C-CS-10, and a `platform` escape hatch) —
  plus `createTooltip()` (hover/focus, delay, `followCursor` via a
  `VirtualElement`) and `createPopover()` (portaled dropdown/panel, width-match,
  placement lock). Exposed as a separate subpath so `@floating-ui/dom` stays out
  of the base import graph.
- **Style injection** (`src/dom/adopt-styles.ts`, SPEC §12.8): two zero-dep
  helpers for the shadow-root CSS plumbing every component re-rolls.
  `adoptStyles(root, ...cssStrings)` adopts static shared stylesheets (one cached
  `CSSStyleSheet` per unique string, shared across instances; `<style>` fallback;
  SSR-safe; dedup per root) — the `main.css?inline` case. `createStyleSlot(root,
  { position?, className? })` → `{ set, clear, destroy }` is a per-instance,
  replaceable `<style>` slot for the `customStylesCallback` case (consistent
  position, so re-setting replaces rather than stacks; `<style>`-based so user
  `@import` works). Free functions, not `BlissElement` methods — core stays
  render-agnostic.

### Changed

- `toText` gained an `isNullable` option: `toText({ isNullable: true })` resolves
  an absent or empty attribute to `null` (an optional string) instead of `''`, so
  callers can tell "unset" from "empty". `null` is the same absent-sentinel
  `toEnum`'s `shouldNullOnInvalid` uses; `null` is accepted on the property path
  (to clear), `''` is still rejected. Non-nullable `toText` is unchanged.
  `isEmptyAllowed` and `isNullable` are orthogonal (keep `''` vs. set the unset
  sentinel to `null`). Surfaced by the multiselect pseudo-migration, where ~20
  attributes are `string | null`.
- **Converter option names now follow the house boolean-naming convention**
  (`is`/`should` prefixes, matching the components' own `isGroupsAllowed` /
  `shouldKeepSearchOnClose`): `toText`/`toList` `trim` → `shouldTrim`, `toText`
  `allowEmpty` → `isEmptyAllowed`, `toEnum` `nullOnInvalid` → `shouldNullOnInvalid`.
  `toList`'s options were also spelled out for intent: `of` → `itemType`, `sep`
  → `separator`, `count` → `requiredCount` (an exact fixed-length check; leaves
  room for future `minRequiredCount` / `maxAllowedCount`). Remaining options
  (`default`, `min`, `max`) are unchanged. Pre-1.0, applied without a
  deprecation shim.
- SPEC §6/§11.3: the single `applyConfig(partial)` hook was split into
  `reinit()` (full rebuild; first connect and any `on: 'reinit'` change) and
  `update(partial)` (in-place patch of changed `on: 'update'` keys). A batch that
  touches any reinit input calls `reinit()` only — the rebuild reads full
  `this.config`, so the update partial is suppressed.
- SPEC §12.1 amended: `loglevel-plugin-prefix` dropped; core depends on
  `loglevel` only and does the colored `%c` prefix in a `loglevel` methodFactory
  (ordering-safe), avoiding the plugin's browser `%c` ordering bug.
- **`toFunction()` now accepts `null` / `undefined`** (value type `Converter<F |
  null>`), so a callback can be CLEARED by assignment — `el.onThing = null`,
  exactly like a DOM event-handler property. Previously the property validator
  rejected anything non-callable, so a callback could never be unset once set.
  Surfaced by the multiselect pseudo-migration (`el.customStylesCallback = null`).

### Fixed

- **CEM: `toEnum` unions now resolve through `as const` and a shared members
  const.** The extractor only matched a bare `ArrayLiteralExpression`, so the two
  forms components actually use — `toEnum(['a','b'] as const, …)` and
  `toEnum(SHARED_PLACEMENTS, …)` — fell back to `string` instead of the member
  union. It now runs the argument through the same `resolveArrayLiteral` used for
  the input/event tables (peeling `as const` and following identifiers).
- **CEM: `registerComponent()` is now recognized as a custom-element
  definition.** The stock analyzer only understands `customElements.define()`, so
  a component registered via core's `registerComponent()` (SPEC §12.3) produced a
  plain class declaration — no `customElement: true`, no `tagName`, no
  `custom-element-definition` export. `blissInputsPlugin` now detects the call
  (unwrapping an `as`-cast class argument) and fills those in. New exports:
  `parseRegisterComponentCall`, `extractRegistrations`, `ExtractedRegistration`.

### Decided

- `toText` (not `toStr`) for the string converter (SPEC §11.1).
- `configKey` (not `key`) for the input-def option key (SPEC §11.2).
- `toBool` accepts a permissive vocabulary (`true/1/yes/on` · `false/0/no/off`,
  case-insensitive); an unrecognized explicit value falls back to the mode
  default, like an absent attribute.
- Store/satellite pattern stays dropzone-local for now (SPEC §11.4).
- Removing an attribute resets that input to its `default` and is reactive
  (absent == default), consistent with construction and the converter layer.

[Unreleased]: https://github.com/keenmate/web-components-core/commits/prod
