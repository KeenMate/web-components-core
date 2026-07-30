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
  per-instance handles for a devtools overlay. Per-instance logging is a noted
  follow-up (§12.3).
- **Logging** (`src/logging/`, SPEC §12.1): `createLoggers(namespace, categories?)`
  returns categorized `NAMESPACE:CATEGORY` loggers over `loglevel`, each with a
  color-coded `%c` prefix; `DEFAULT_CATEGORIES` (`INIT/DATA/UI`), redefinable and
  extendable; `enableLogging()` (defaults to `debug`) / `disableLogging()` /
  `setLogLevel()` / `setCategoryLevel()`. Plus the opt-in `createPerfLogger()`
  (`start`/`end`/`measure`/`summary`/`clear`).

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
