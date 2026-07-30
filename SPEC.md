# `@keenmate/web-components-core` — design spec

**Status:** v1 implemented under `src/` (TypeScript + Vitest, 35 tests). This
file remains the design source of truth; the §11 decisions below are resolved
and reflected in the code.
**Repo:** `C:\Git\KM\web-components-core` → npm `@keenmate/web-components-core`.
**v1 scope (agreed):** the **reactive input model** (converter-driven
attribute/property/callback definitions) and the **`BlissElement` base
class** (observed-attributes / `attributeChangedCallback` / property
reactivity / batching / SSR stub / `define` / typed event dispatch).
Additional shared functionality (logger, positioning, …) is tracked in
§12 for discussion, not part of v1.

Grounded in a survey of five shipping components (§1) — but the design
is chosen on merit, not on what the repos happen to do today.

---

## 1. Why — the divergence we're consolidating

Every `web-*` component re-implements the same element plumbing, and has
drifted into **four different dialects of the attribute table** plus
private copies of the same base wiring:

| Component | Layout | Attribute model | Base-element wiring |
|---|---|---|---|
| **web-multiselect** | single-pkg | string-tag: `parser:'enum', enumValues:[…]` + central switch | local SSR stub; `setAttributes()` batching |
| **web-daterangepicker** | single-pkg | **functions**: `parseEnum(CONST)`, `parsePipeDelimitedList(12)`, … | local SSR stub |
| **web-treeview** | single-pkg | **`{ kind:'string'\|'number'\|'boolean'\|'enum' }`** union + `field` | local SSR stub |
| **web-dropzone** | monorepo + `web-dropzone-core` | string-tag, extended with a `'bytes'` tag | **`SatelliteElement` base** + `resolveEnumAttribute()` + scheduler; **5 elements** |
| **web-grid** | monorepo | **none** — config-object / property driven | `GridElement extends HTMLElement` (no SSR stub) |

Requirements this surfaces (not a design):

- Cover **enums (exact match), numbers, strings, custom parsers
  (month-names, `'auto'\|0..6`), and callbacks** — each input **reactive**.
- The attribute table must be **opt-in** (web-grid has none).
- Multi-element packages exist (dropzone's 5); the base must serve N
  elements per package.
- The string-tag menu keeps needing extension (dropzone `'bytes'`,
  treeview `field`) — a closed set is a maintenance tax.

---

## 2. Design priorities (the decision that drove this design)

Two separable concerns, **not** equal weight:

1. **PRIMARY — definition ergonomics + parsing/validation correctness +
   reactivity.** One unified, very solid way to declare every input and
   guarantee incoming values are validated and correctly parsed.
2. **SECONDARY — docs / IntelliSense.** Fed from **JSDoc comments** (the
   BlissFramework C-CEM-13 canonical format). Autodetection of enum
   values is a nice-to-have, **not** something the structure stands on.

Because introspection is *not* load-bearing, the parser does **not** need
to be a closed, machine-readable `{ kind }` union (that form hits a wall
the moment a component needs something new). Behavior is expressed as
**functions**; correctness is enforced by **converters**; docs come from
**comments**. That is the model below.

---

## 3. Package layout (v1)

```
web-components-core/                 (@keenmate/web-components-core)
├── src/
│   ├── inputs/
│   │   ├── types.ts        ← Converter, InputDef
│   │   ├── converters.ts   ← toEnum, toInt, toFloat, toBool, toText, toList, toBytes, toCustom, toFunction
│   │   └── apply.ts        ← the parse+validate+stage pipeline
│   ├── element/
│   │   ├── bliss-element.ts ← base: SSR stub, observedAttributes, attr+property reactivity, batching
│   │   ├── dispatch.ts      ← typed CustomEvent helper
│   │   └── define.ts        ← idempotent customElements.define wrapper
│   ├── dom/
│   │   ├── resolve-enum-attribute.ts   (lifted from dropzone)
│   │   └── microtask-scheduler.ts      (lifted from dropzone)
│   └── index.ts
```

Consumed as a normal runtime `dependency`, bundled into each component's
`dist` (they already bundle `@floating-ui/dom`).

---

## 4. The model — one reactive input table

Every public input — attribute, complex property, or callback — is one
row. Each row names it, says how to turn an incoming value into a correct
typed value, its default, and what a change triggers. There is **no
central switch**: dispatch is `def.converter.fromAttribute(raw)`.

```ts
export type AttrReader = { getAttribute(n: string): string | null; hasAttribute(n: string): boolean };

export type Reactivity = 'update' | 'reinit' | 'none';   // apply in place / full rebuild / store only

export interface Converter<V> {
  /** attribute path: raw string (null when absent/removed) → validated V (or fallback). */
  fromAttribute?(raw: string | null, el: AttrReader, attr: string): V;
  /** property path: is this JS-assigned value acceptable? (callbacks, arrays, objects). */
  validate?(value: unknown): value is V;
  /** optional reflect V → attribute string. */
  toAttribute?(value: V): string | null;
}

export interface InputDef<V = unknown> {
  /** config option key, e.g. 'selectionMode' / 'getBadgeDisplayCallback'. */
  configKey: string;
  /** kebab attribute name; OMIT for property-only inputs (callbacks, rich objects). */
  attribute?: string;
  /** optional private backing field to also set, e.g. '_treeId' (treeview pattern). */
  field?: string;
  /** how to parse (attribute) and validate (property). */
  converter?: Converter<V>;
  default?: V;
  /** what a change triggers. Default 'update'. */
  on?: Reactivity;
  /** reflect property → attribute? */
  reflect?: boolean;
}
```

One converter per input owns **both** parsing (from an attribute string)
and validation (of a JS-assigned value) — correctness lives in one place
and can't drift across the three spots it used to.

---

## 5. Converter library (`to*` factories)

Common cases stay one-liners; the converter is where "ensure the value is
correct" is enforced. Naming: `to<Type>` — "convert the raw value to a …".

```ts
toEnum(values, { default?, shouldNullOnInvalid? })  // exact-match against the set; invalid → default (or null)
toInt({ min?, max?, default? })                // parse + range-check; NaN/out-of-range → default
toFloat({ min?, max?, default? })
toText({ shouldTrim?, isEmptyAllowed?, isNullable?, default? })  // string (NOT toString). isNullable:true → absent/empty is null (optional string), not ''
toBool('presence' | 'default-true' | 'default-false' | 'tristate')
toBytes({ default? })                          // "10mb" → 10485760
toList({ itemType: 'string' | 'int', separator?, requiredCount? }) // CSV / pipe-list, with optional fixed-length validation
toCustom(parseFn)                              // wrap any bespoke parser  (month-names, 'auto'|0..6)
toFunction()                                   // callback: property-only, validates typeof === 'function'
toValue({ validate?, default? })               // rich value; property = validate, attribute = JSON, reflects JSON
toObjectArray({ validateItem?, default? })     // array of rich items (e.g. `options`); property = array, attribute = JSON; default []
toObject({ validate?, default? })              // plain (non-array) object; property = object, attribute = JSON
```

`toValue`/`toObjectArray`/`toObject` are the rich-data family: property-first
(the shape check IS the `validate`), with a JSON attribute path when the input
declares an `attribute`. They are the core home for the "property-only array /
object" pattern components used to hand-write (SPEC gap #2, resolved).

Each factory returns a `Converter<V>`; `toEnum`/`toList`/… set both
`fromAttribute` and `validate` from the same inputs, so a property
assignment is validated against the same rules an attribute is parsed by.
A brand-new input type is just a **new converter created anywhere** (in
core or a component) — no core edit, no closed union.

### Mapping the requirements

```ts
// exact-match enum
{ configKey:'selectionMode', attribute:'selection-mode', converter: toEnum(SELECTION_MODES, {default:'single'}), on:'update' }
// number
{ configKey:'optionHeight', attribute:'option-height', converter: toInt({ min:1, default:50 }) }
// string
{ configKey:'searchPlaceholder', attribute:'search-placeholder', converter: toText({ default:'Search...' }) }
// custom parser (month-names → 12-item array)
{ configKey:'monthNames', attribute:'month-names', converter: toCustom(parseMonthNames), on:'reinit' }
// the 'auto' | 0..6 case
{ configKey:'weekStartDay', attribute:'week-start-day', converter: toCustom(parseWeekStartDay) }
// callback (property-only, reactive)
{ configKey:'getBadgeDisplayCallback', converter: toFunction(), on:'update' }
```

---

## 6. Reactive engine — `BlissElement`

SSR-safe (the `typeof HTMLElement` stub every repo copies). Wires inputs
**only if the subclass provides a table** — web-grid can extend it for
the SSR base + `dispatch` and skip the table.

```ts
const Base = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as typeof HTMLElement;

export abstract class BlissElement extends Base {
  protected static inputs?: readonly InputDef[];

  static get observedAttributes(): string[] {
    return (this.inputs ?? []).filter(d => d.attribute).map(d => d.attribute!);
  }

  // ATTRIBUTE path → converter.fromAttribute → stage → dispatch per `on`
  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void { /* … */ }

  // PROPERTY path: base generates get/set per configKey → converter.validate → stage → dispatch per `on`
  //   el.selectionMode = 'range'          → reactive
  //   el.getBadgeDisplayCallback = fn     → reactive (callbacks too)

  // BATCHING: setAttributes({...}) / batch(fn) coalesce many changes into ONE reinit()/update()
  setAttributes(values: Record<string, unknown>): void { /* … */ }
  batch(fn: () => void): void { /* … */ }

  /** Full rebuild (reads this.config). Called on first connect and on any `on:'reinit'` change. */
  protected reinit(): void { /* opt-in, no-op by default */ }
  /** In-place patch of the changed `on:'update'` keys. Called only when no reinit key changed. */
  protected update(partial: Record<string, unknown>): void { /* opt-in, no-op by default */ }

  // LIFECYCLE: build-once + activate/deactivate (Lit's model). connect()/disconnect()
  // fire on EVERY connect/disconnect; a plain DOM move re-activates, never rebuilds.
  /** Start live resources (listeners, observers, floating-ui autoUpdate). Every connect, after reinit/update. */
  protected connect(): void { /* opt-in, no-op by default */ }
  /** Stop what connect() started. Every disconnect. Shadow DOM persists — don't tear down structure. */
  protected disconnect(): void { /* opt-in, no-op by default */ }
}
```

The **same pipeline serves both entry points** — attributes *and*
properties/callbacks — so everything is reactive by construction:

- **Attribute change** → `converter.fromAttribute(raw)` → stage → dispatch.
- **Property assignment** → `converter.validate(value)` → stage → dispatch.
- **Dual-path** (month-names as a pipe-string *or* an array): same row,
  `fromAttribute` handles the string, `validate` guards the array.
- **Batching** coalesces bursts, then dispatches to exactly one hook:
  `reinit()` if the batch touched any `on:'reinit'` input (it reads the
  already-merged `this.config`, so it absorbs any `update` keys in the same
  batch), otherwise `update(partial)` with just the changed `update` keys.
  A change is always staged into `config` before either hook fires, and
  `on:'none'` inputs are stored without firing either hook.
- **Reactivity contract** declared per input (`on`) and enforced
  centrally — no input can be added that forgets to parse, validate, or
  react.
- **Lifecycle** is build-once + activate/deactivate (Lit's model). `reinit()`
  builds structure; `connect()`/`disconnect()` start/stop live resources on
  every connect/disconnect. Connect order is `reinit()`/`update()` (for any
  pending config) then `connect()`. A DOM move (reorder, re-parent) fires
  `disconnect()`→`connect()` and re-activates **without** rebuilding, so
  transient UI state (scroll, focus, open panels) survives. Config changed while
  detached is held and applied on reconnect, before `connect()`.

Plus a typed `dispatch(el, name, detail, {bubbles=true, composed=true})`
and generic DOM utils (`resolveEnumAttribute`, `createMicrotaskScheduler`)
lifted from dropzone. The store/satellite topology stays dropzone-local.

The `static inputs` table is sanity-checked once per class at construction
(warn-only, never throws): duplicate `configKey`/`attribute`, or `reflect:true`
without an `attribute` / without `converter.toAttribute`. Removing an attribute
is reactive — it resets that input to its `default` (absent == default).

---

## 7. Fit check — all five components

- **multiselect** — `{parser:'enum', enumValues}` → `toEnum(...)`;
  `bool-default-true` → `toBool('default-true')`; `setAttributes` batching
  → `BlissElement`.
- **daterangepicker** — `parseEnum(CONST)` → `toEnum(CONST)`;
  `parsePipeDelimitedList(12)` → `toList({itemType:'string', separator:'|', requiredCount:12})`;
  `parseWeekStartDay` → `toCustom(parseWeekStartDay)`; tri-state →
  `toBool('tristate')`.
- **treeview** — `{kind}` union → converters; its `field` column is why
  `InputDef.field?` exists; near-mechanical.
- **dropzone** — `'bytes'` tag → `toBytes()`. Store element extends
  `BlissElement`; satellites keep the dropzone topology but swap their SSR
  stub for `BlissElement` and use core's `dispatch` /
  `resolveEnumAttribute` / scheduler.
- **web-grid** — **no table.** Extends `BlissElement` for the SSR base +
  `dispatch()` only; keeps its property/config-object API. Proves the
  table is opt-in; grid gains an SSR stub it currently lacks.

---

## 8. Docs / IntelliSense (secondary)

Enum values and descriptions are authored as **JSDoc on the config
member**, in the C-CEM-13 canonical format (intro line → blank line →
bullet-per-value). Independent of the parser structure. *Optionally* a
converter like `toEnum(VALUES)` may expose `.values` for future
autodetect — but nothing depends on it.

**Amendment (source-of-truth split, §12.4 CEM tooling).** With the CEM
plugin built, this splits cleanly: the input/event **table owns the
STRUCTURE** (attribute↔property mapping, type, default, `reflect`, enum
members — all derivable from the row + its converter), and **prose stays
authored by a human** — now as an optional `description` / `deprecated`
field *on the row itself* (`InputDef.description`, `EventDef.description`),
or a leading comment on the row. So JSDoc-style structural re-declaration
(`@attr {single|multiple} selection-mode`) is gone — it can't drift from
the converter — and authors write only the "extra help text." This
*tightens* the original rule (JSDoc-only) rather than contradicting it:
descriptions are still hand-authored, they just live in the one table.

---

## 9. Migration plan (per repo, low-risk, ordered)

1. **Build core v1** + unit tests for every converter (incl. the
   daterangepicker `toCustom` cases) and the reactive pipeline.
2. **treeview first** — closest existing shape; validates the API.
3. **multiselect + dropzone** — string-tag → converter translation; fold
   batching into `BlissElement`; `'bytes'` → `toBytes`.
4. **daterangepicker** — function parsers → converters; the 3–4 bespoke
   ones become `toCustom`.
5. **web-grid** — adopt `BlissElement` for base + `dispatch` only.

One PR per repo, behind each component's existing tests; no
consumer-facing attribute/event changes.

---

## 10. BlissFramework guideline changes this implies (later)

- **CLAUDE.md** — new invariant: web-components build on
  `@keenmate/web-components-core`; don't re-implement observed-attribute /
  parse / dispatch plumbing.
- **component-structure.md** — Element layer extends `BlissElement`;
  document the opt-in input table.
- **naming-conventions.md / C-NC-7** — the single `ATTRIBUTE_TABLE`
  becomes a single table of core `InputDef` rows with `to*` converters.
- **custom-elements-manifest.md** — cross-ref: values authored in JSDoc
  (C-CEM-13); autodetect from converters optional.

---

## 11. Decisions (formerly open questions)

1. **String converter → `toText`.** RESOLVED: `toText` (not `toStr`), avoiding
   the `Object.prototype.toString` collision.
2. **Config-key field → `configKey`.** RESOLVED: kept the explicit `configKey`
   (not shortened to `key`).
3. **Reactivity dispatch → `reinit()` / `update(partial)`.** RESOLVED: the base
   splits the single hook into two. `reinit` means rebuild the whole component;
   `update` means patch a part in place. A batch that touches any `on:'reinit'`
   input calls `reinit()` only — since the rebuild reads full `this.config`, the
   `update` partial would be redundant, so it is suppressed. First connect always
   calls `reinit()`. Both hooks are no-op by default, so the table stays opt-in
   (web-grid overrides neither). See §6.

   Also settled here: `toBool` accepts a permissive true/false vocabulary
   (`true/1/yes/on` · `false/0/no/off`, case-insensitive); an unrecognized
   explicit value falls back to the mode default, exactly like an absent
   attribute — consistent with every other converter.
4. **Store/satellite pattern** — DEFERRED: stays dropzone-local until a second
   component needs it (recommended).
5. **Derived / fallback defaults → stay in `reinit()`.** RESOLVED (by design):
   `InputDef.default` is a static literal on purpose. A value whose "when absent"
   is *computed from other inputs* (e.g. `searchValueMember` falling back to
   `displayValueMember`) is NOT a declarable input concern — it is derived in
   `reinit()`/`update()` from the already-merged `this.config`. Rationale: the
   real cases are either **use-site / per-item** (the multiselect's search
   fallback is `() => getItemDisplayValue(item)` — depends on the option object,
   so it can never be an input default) or **config→config**, which would require
   a computed-property dependency graph (which keys does it read? when does it
   recompute? track "was it explicitly set"?) that contradicts core's flat,
   independently-resolved input model. Surfaced as gap #3 by the multiselect
   pseudo-migration; closed without new machinery.

---

## 12. Common functionality roadmap (to discuss — beyond v1)

Candidates already duplicated across components, in rough priority order.
Each becomes its own core module once we agree the shape.

### 12.1 Logger — IMPLEMENTED (`src/logging/`)

**Status:** built. Amended from the original decision: core depends on
**`loglevel` only** — `loglevel-plugin-prefix` was dropped. Its browser `%c`
handling is precisely the "ordering bug" noted below, so core does the colored
`NAMESPACE:CATEGORY` prefix directly in a `loglevel` `methodFactory`
(ordering-safe by construction: `%c[label]`, the CSS string, then the raw
message args — messages stay uncoloured and structured-loggable). `createLoggers`
is idempotent per logger name (won't double-wrap), assigns each category a stable
palette colour by index, and `enableLogging()` defaults to `debug`. Original
context and decision retained below.

Context: all five components already use **loglevel +
loglevel-plugin-prefix** with the same shape — categorized named loggers
(`NAMESPACE:CATEGORY`), a color-coded `%c` prefix, and an
`enableLogging` / `disableLogging` / `setLogLevel` / `setCategoryLevel`
API over a `LOGGING_CATEGORIES` list. The differences (three repos
**vendor** loglevel under `src/vendor/`, daterangepicker uses the npm
packages; slightly different category names; multiselect carries a
method-factory that fixes a `%c` ordering bug) are historical accretion,
not design choices.

**Decision:** logging moves into core.

- Core takes **`loglevel` as its own npm dependency** (bundled into each
  component's dist; **no more vendoring**). *(Amended: `loglevel-plugin-prefix`
  dropped — see status note above.)*
- Core owns the color `%c` prefix, with multiselect's ordering fix baked
  in so every component gets it.
- **Default categories, overridable.** Core ships a baseline set; a
  component uses it as-is, redefines it, or extends it.

```ts
export const DEFAULT_CATEGORIES = ['INIT', 'DATA', 'UI'] as const;

export function createLoggers<C extends string>(
  namespace: string,
  categories: readonly C[] = DEFAULT_CATEGORIES,
): {
  loggers: Record<C, Logger>;
  enableLogging(): void;
  disableLogging(): void;
  setLogLevel(level: LogLevel): void;
  setCategoryLevel(category: C, level: LogLevel): void;
  LOGGING_CATEGORIES: readonly C[];
};
```

Usage — defaults, redefine, or extend:
```ts
const { loggers } = createLoggers('MULTISELECT');                                   // defaults: INIT/DATA/UI
const { loggers } = createLoggers('TREEVIEW', ['INIT','DATA','INDEX','UI','DRAG']); // redefine
const { loggers } = createLoggers('DROPZONE', [...DEFAULT_CATEGORIES, 'FILE']);     // extend
export const { INIT: initLogger, DATA: dataLogger, UI: uiLogger } = loggers;
```

Optional companion module: `createPerfLogger(namespace)` (treeview's
`perfStart` / `perfEnd` / `perfMeasure` / `perfSummary`), opt-in per
component.

### 12.2 Positioning — IMPLEMENTED (`src/positioning/`)

**Status:** built as the `@keenmate/web-components-core/positioning` subpath over
a single pinned `@floating-ui/dom` (`^1.8`) — the one added runtime dependency,
kept out of the base import graph so components that don't position pay nothing.
Ships the proposed shape below: `anchor()` + `createTooltip()` +
`createPopover()`. Resolutions of the survey's open points:

- **follow-cursor** → a `followCursor?: boolean` option on `createTooltip` (it
  anchors to a `VirtualElement` tracking the pointer), NOT a third preset.
- **Custom shadow-DOM platform** → NOT ported. floating-ui 1.8's built-in shadow
  handling covers it; `anchor` exposes an optional `platform` escape hatch for
  any residual edge case rather than baking in multiselect's bespoke (and
  unverifiable-here) platform.
- **`data-theme` inheritance (C-CS-10)** → `anchor` copies the nearest
  `data-theme` (via `closest('[data-theme]')`) from `inheritThemeFrom` onto the
  floating element; the presets default `inheritThemeFrom` to the trigger /
  reference, so portaled layers keep the theme automatically.
- **Width-matching** → one `matchWidth: 'min' | 'exact' | false` (via `size()`),
  replacing the three per-component hacks.
- **`lockPlacement`** → feeds `flip({ fallbackStrategy: 'initialPlacement' })`,
  so the initial placement is preferred over reordering.

Tests mock `@floating-ui/dom` (jsdom has no layout / `ResizeObserver`) and cover
the wrapper contract: middleware order/selection, `matchWidth`→`size`,
`lockPlacement`→flip fallback, theme inheritance, tooltip show/hide + delay +
follow-cursor + listener teardown, popover open/close idempotency. The original
survey follows.

---

### 12.2 (survey) Positioning — `@floating-ui/dom`

Context: **all five** depend on `@floating-ui/dom`, on **three drifted
versions** (`1.5.3` / `1.7.4` / `1.7.6`), and re-wrap it in ~15 call
sites. Two shapes recur:

- **Tooltip** (`tooltip.ts` in multiselect / daterangepicker / grid):
  `strategy: 'fixed'`, middleware `[offset(d), flip(), shift({padding:8})]`,
  hover-in/out with a delay, mounted to the shadow root **or**
  `document.body`, `autoUpdate` while visible. multiselect already has a
  clean `TooltipOptions` interface to lift.
- **Dropdown / popover / panel** (multiselect dropdown, daterangepicker
  calendar, grid contextmenu/datepicker/dropdown/toolbar, dropzone
  popover): default `placement: 'bottom-start'`, middleware
  `[offset(n), flip() (often conditional on a placement lock),
  shift({padding:8})]`, optional `size()` for **width-matching**
  (three different hacks today: a `--ms-input-current-width` CSS var,
  `size()`, and raw `minWidth`/`maxWidth`), `autoUpdate` while open,
  usually portaled to `document.body`.

Notable divergences to unify:
- `strategy` is `'fixed'` in ms/drp/dz but `'absolute'` in grid. Core
  default `'fixed'` (portal-friendly, avoids ancestor clipping); caller
  can override.
- multiselect passes a **custom `platform`** to correct offsets inside
  shadow DOM — that fix belongs in core so everyone gets it.
- Portaling to `document.body` is where guideline **C-TC-8**
  (fixed-floating-UI exception) and **C-CS-10** (portaled layer must
  receive `data-theme` for dark mode) live — core should carry
  `data-theme` onto the floating element at open time, solving C-CS-10
  once instead of per component.

Proposed core shape — one low-level anchor + two presets, each returning
a teardown that stops `autoUpdate`:

```ts
// low-level: place `floating` against `reference`, keep it placed
anchor(floating: HTMLElement, reference: HTMLElement | VirtualElement, opts: {
  placement?: Placement;              // default 'bottom-start'
  strategy?: 'fixed' | 'absolute';    // default 'fixed'
  offset?: number;                    // default 4
  flip?: boolean;                     // default true (skipped when lockPlacement holds)
  shift?: number | false;             // padding; default 8
  matchWidth?: 'min' | 'exact' | false;   // via size(); default false
  lockPlacement?: boolean;            // keep first placement unless it must flip
  autoUpdate?: boolean;               // default true
  inheritThemeFrom?: HTMLElement;     // copy data-theme onto `floating` (C-CS-10)
  onPlaced?(placement: Placement): void;
}): { update(): void; destroy(): void };

createTooltip(opts: { trigger; container; content; placement?; offset?; delay?; cssClass?; visibleClass? }): TooltipHandle;
createPopover(opts: { reference; panel; container?; placement?; matchWidth?; lockPlacement?; strategy? }): PopoverHandle;
```

Pin one `@floating-ui/dom` version in core (ends the 1.5/1.7 drift).
Open: is the tooltip preset rich enough to also cover
`follow-cursor` (multiselect `option-tooltip-follow-cursor`) via a
`VirtualElement`, or is that a third preset?

### 12.3 Global registration (`window.components`) — IMPLEMENTED (`src/global/`)

**Status:** built. Every shipping component copy-pasted a
`window.components[tag] = { version, config, logging, register, getInstances }`
block, and it drifted five ways: instance tracking was a `Set` in three, a
`querySelectorAll` in daterangepicker, and absent in grid; grid also dropped
`register()`/`getInstances()`; treeview dropped `logging`; daterangepicker
auto-registered while the rest did not. Core consolidates it:

- **`registerComponent(tag, elementClass, { config, logging?, shouldAutoDefine? })`**
  — publishes the entry to `window.components[tag]`, defines the element via the
  idempotent `define()` (auto by default; `shouldAutoDefine: false` defers to the
  exposed `register()`), and flattens a `createLoggers()` `LoggerBundle` into the
  `logging` controls (`enableLogging`/`disableLogging`/`setLogLevel`/
  `setCategoryLevel`/`getCategories`). Returns the entry (generic on the element
  type). SSR-safe: the global write is skipped without `window`, `define()`
  no-ops without `customElements`.
- **Live-instance registry** — `BlissElement` adds itself to a per-tag `Set` on
  connect and removes itself on disconnect (a DOM move re-tracks the same
  element, no duplicate). `getInstances(tag)` returns the live elements; the
  registry entry's `getInstances()` is wired to it. No per-component tracker.
  The elements ARE the per-instance handles: a devtools overlay
  (Ctrl-Alt-C → list a tag's instances → act on one) enumerates tags via
  `window.components` + `getRegisteredTags()` and each tag's instances via
  `getInstances()`.
- **Per-instance logging** — `BlissElement` exposes `this.log` (an instance
  logger per category of the tag's `createLoggers` bundle, wired by
  `registerComponent`'s `logging` option). Each line is prefixed with a `tag#id`
  handle (the element's own `id` when set, else a `tag#n` counter) and gated by
  the MORE verbose of the type-level category level and the
  instance's own override, emitting via `console` directly so an instance can
  log while its type stays silent. `element.enableLogging(level?)` /
  `disableLogging()` / `isLoggingEnabled` are the overlay's per-instance switch:
  pick one instance from `getInstances()`, flip it loud, leave the rest quiet.
  Components should prefer `this.log.<CATEGORY>` over the shared type-level
  loggers so this scoping works. `bundle.forInstance(id, getOverride)` is the
  underlying factory; a tag→bundle map (`logger-registry.ts`) lets the element
  base find its bundle by `localName`.

### 12.4 Other candidates (later modules)
- **Callbacks & events model** — IMPLEMENTED, see §12.5 (`static events` +
  `emit()` + managed `on<Name>` properties, and `runHook()` for `*Callback`s).
- **Theming / CSS cascade-layer helpers** — the RUNTIME step (adopt a
  stylesheet into a shadow root) is IMPLEMENTED, see §12.8 (`adoptStyles`
  + `createStyleSlot`). The authoring conventions (`@layer` order, `?inline`
  import) stay pure CSS-guideline, no code.
- **CEM tooling preset** — IMPLEMENTED, see §12.6 (`/cem`: analyzer config
  preset + a plugin that reads the `static inputs` / `static events` tables).
- **Testing utilities** — IMPLEMENTED, see §12.7 (`/testing`: runner-agnostic
  mount/upgrade/event fixtures) + `whenSettled()` on `BlissElement`. The
  Playwright/a11y-contrast layer is deferred (out of the input-model core).
```

### 12.6 CEM tooling preset — IMPLEMENTED (`src/cem/`)

**Status:** built as the `@keenmate/web-components-core/cem` subpath (build-time
only — no runtime dependency; the analyzer injects the `typescript` API). The
stock `@custom-elements-manifest/analyzer` can't see our public surface — it
lives in `static inputs` / `static events` tables, not the Lit-style patterns it
recognizes — so without help the manifest would be empty.

- **`blissInputsPlugin()`** — an analyzer plugin. In `analyzePhase` it extracts
  each table-driven class; in `moduleLinkPhase` it merges the results into the
  manifest's class declaration (augments, never replaces, the analyzer's own
  analysis).
- **`extractBlissClass(ts, classNode, sourceFile)`** — the pure, unit-tested
  core. From each `InputDef` row it derives an `attribute` (kebab, with
  `fieldName` back-link) and a `field` member: **type** from the converter
  (`toEnum([...])` → union, `toInt` → `number`, `toText({isNullable})` →
  `string | null`, `toBool('tristate')` → `boolean | null`, …), **default** from
  the row's `default` or the converter's, **reflects** from `reflect`, and
  **description/deprecated** from the row (or a leading comment). It follows an
  identifier to a `const TABLE = [...] as const` and unwraps `as const` /
  parentheses, so both inline and hoisted tables work. Events come from bare
  names or `EventDef` objects.
- **`blissAnalyzerConfig(options?)`** — the shared config preset (globs,
  excludes, `outdir`, plugins) every component's `custom-elements-manifest.config.js`
  extends, with the plugin pre-wired.

The source-of-truth split (§8 amendment): structure from the table, prose from
the optional `description` / `deprecated` fields on each row.

### 12.7 Testing utilities — IMPLEMENTED (`src/testing/` + `whenSettled()`)

**Status:** built. Two parts.

- **`BlissElement.whenSettled(): Promise<void>`** — a first-class "await the
  pipeline" signal, in **core** (not just tests). Resolves once every staged
  change has flushed and its `reinit()`/`update()` has run; resolves immediately
  when nothing is pending. `setAttributes()`/`batch()` flush synchronously (so
  the element is already settled after them); loose property assignment coalesces
  on a microtask (so `el.x = …; await el.whenSettled()` awaits it). While
  detached, pending changes are held, so the promise resolves on the next
  connect's flush. This replaces the flaky bare-`await Promise.resolve()` guess
  in tests AND gives consumers a deterministic read-after-write point.
- **`@keenmate/web-components-core/testing`** — runner-agnostic DOM fixtures
  (pure DOM, zero deps, so they work under vitest+jsdom or a real browser):
  `mount(html|element)` (+ tracked `cleanup()`), `mountBeforeUpgrade()` (exercise
  the pre-upgrade property-capture path), `uniqueTag()` / `defineOnce()`,
  `nextTick()` / `nextFrame()`, and `listen(target, type)` → an `EventSpy`
  (`count` / `events` / `last` / `lastDetail` / `stop()`) for asserting §12.5
  emits without a mocking library.

The Playwright + a11y/contrast fixtures the original §12.4 note mentioned are
**deferred** — they need a real-browser toolchain and belong closer to a
design-system/theming package than the input-model core.

### 12.8 Style injection — IMPLEMENTED (`src/dom/adopt-styles.ts`)

**Status:** built (main index — tiny, zero-dep). The §12.4 theming candidate was
hedged as "may need no runtime code"; the resolution is that the *authoring*
conventions stay pure guideline, but the two *runtime* injection steps every
component re-rolls become core helpers. Core deliberately does NOT touch shadow
DOM elsewhere (it is render-agnostic — web-grid uses light DOM), so these are
free functions taking a root + CSS strings, NOT `BlissElement` methods.

- **`adoptStyles(root, ...cssStrings)`** — STATIC, shared stylesheets (the
  `main.css?inline` pattern). One `CSSStyleSheet` per unique string, cached
  module-level and shared across every instance via `adoptedStyleSheets` (dedup
  per root); `<style>` fallback where constructable sheets are unsupported;
  no-op under SSR.
- **`createStyleSlot(root, { position?, className? })`** → `{ set, clear,
  destroy }` — a PER-INSTANCE, replaceable `<style>` slot for the
  `customStylesCallback` pattern (user CSS that changes at runtime). One element
  at a consistent position, so re-`set` replaces rather than stacks — fixing the
  prepend-on-init / append-on-update inconsistency the components have today
  (e.g. multiselect's `.ms-custom-styles` handling). `<style>`-based on purpose:
  user CSS may use `@import`, which constructable stylesheets reject. Core owns
  the mechanism; the `customStylesCallback` input row stays in each component's
  table (a `toFunction()` returning a CSS string).

The `?inline` import (Vite build concern) and the `@layer variables, component,
overrides` order (CSS guidelines, invariants #6–#9) stay authoring rules — the
helpers take strings and don't care how you got them or how they're layered.

### 12.5 Callbacks & events — IMPLEMENTED (`src/element/`)

**Status:** built. The five components hand-roll two distinct things every time,
and both drift. The naming convention already separates them, and core now gives
each ONE unified primitive:

- **`*Callback` suffix = a hook that shapes behavior/state.** Interceptors
  (`beforeDateSelectCallback`), providers (`getDateMetadataCallback`), renderers
  (`renderDayCallback`). Its **return value matters** (veto / adjust / supply)
  and it may be async.
- **Events = outward, fire-and-forget notifications.** No `Callback` suffix
  (`select`, `change`, `date-select`). The `on<Name>` property is a listener
  alias, not a callback — return value ignored.

**Events — `static events` + `emit()` + managed `on<Name>` properties.** A
component declares its notifications in a `static events` table (a bare name, or
an `EventDef` for dispatch/property overrides). `emit(name, detail)` is a typed
dispatch (name + detail checked against the component's `BlissElement<TEvents>`
event map, per-event `bubbles`/`composed` overrides applied). The paired
`on<Name>` property (default `on` + PascalCase, e.g. `onDateSelect`) is installed
as a **managed listener**: assigning it does `removeEventListener(old)` +
`addEventListener(new)`, so `el.onSelect = e => e.detail.option` is *identical*
to `addEventListener('select', …)` and receives the same `CustomEvent`. This is
the deliberate contract choice (SPEC decision): the handler receives the
**event**, not a bare positional arg — matching the platform's own `onclick`
convention and collapsing the property path and `addEventListener` into ONE
delivery path, so `emit` never calls the property separately. A typed
`on(name, handler)` method (returns an unsubscribe) complements the property.
The old per-component pattern — `onSelect: (o) => { this._onSelect?.(o);
this.dispatchEvent(new CustomEvent('select', …)) }` — collapses to
`this.emit('select', { option })`.

**`*Callback` — `runHook(key, ctx, { whenUnset, onError? })`.** Core owns only
the drift-prone plumbing: unset → `whenUnset`; the callback is invoked with a
single `ctx` argument and its result is normalized through `Promise.resolve` (so
sync OR async both work); a throw routes to `onError` if given, else **re-throws**
(no silent swallow — a component that forgets `onError` fails loudly). The
**result contract stays the component's** — core cannot own the discriminant,
because the two daterangepicker hooks already disagree on it
(`BeforeSelectResult.action: accept|adjust|restore|clear` vs
`BeforeMonthChangeResult.action: accept|block`), exactly as core can't own event
names. So `callBeforeSelectCallback`'s guard + `await Promise.resolve` + try/catch
collapse into the call, while its `switch (result.action)` interpretation and
loader/`isValidating` side-effects stay in the component.

**Dev-time lint** (warn-only, once per class, with the input-table checks):
duplicate event name; a name that isn't lowercase kebab/bare (the `date-select`
convention); an `on<Name>` property that collides with an input `configKey`.

**Deferred to each component's next major:** the actual string renames the
convention implies (`rowdelete` → `row-delete`, treeview's tense drift). Core
accepts every existing name verbatim; standardizing the vocabulary is a breaking
change and rides the same major bump that adopts core.
