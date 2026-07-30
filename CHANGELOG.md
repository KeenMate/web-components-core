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
- Typed `dispatch()` (composed + bubbling by default) and idempotent, SSR-safe
  `define()`.
- DOM utilities (`src/dom/`): `resolveEnumAttribute`, `createMicrotaskScheduler`.
- **Always-on invalid-input warnings**: `BlissElement` emits `console.warn` for
  rejected property values and for converters that throw (falling back to the
  input's `default`). Deliberately bypasses the logger so it surfaces even when
  logging is disabled.
- **Logging** (`src/logging/`, SPEC §12.1): `createLoggers(namespace, categories?)`
  returns categorized `NAMESPACE:CATEGORY` loggers over `loglevel`, each with a
  color-coded `%c` prefix; `DEFAULT_CATEGORIES` (`INIT/DATA/UI`), redefinable and
  extendable; `enableLogging()` (defaults to `debug`) / `disableLogging()` /
  `setLogLevel()` / `setCategoryLevel()`. Plus the opt-in `createPerfLogger()`
  (`start`/`end`/`measure`/`summary`/`clear`).

### Changed

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

[Unreleased]: https://github.com/keenmate/web-components-core/commits/prod
