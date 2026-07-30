# `@keenmate/web-components-core` — design spec

**Status:** design-first. This file seeds the repo; no code yet.
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
toEnum(values, { default?, nullOnInvalid? })   // exact-match against the set; invalid → default (or null)
toInt({ min?, max?, default? })                // parse + range-check; NaN/out-of-range → default
toFloat({ min?, max?, default? })
toText({ trim?, allowEmpty?, default? })       // string  (NOT toString — collides with Object.prototype)
toBool('presence' | 'default-true' | 'default-false' | 'tristate')
toBytes({ default? })                          // "10mb" → 10485760
toList({ of: 'string' | 'int', sep?, count? }) // CSV / pipe-list, with optional count validation
toCustom(parseFn)                              // wrap any bespoke parser  (month-names, 'auto'|0..6)
toFunction()                                   // callback: property-only, validates typeof === 'function'
```

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

  // ATTRIBUTE path → converter.fromAttribute → stage → apply per `on`
  attributeChangedCallback(name: string, _old: string | null, raw: string | null): void { /* … */ }

  // PROPERTY path: base generates get/set per configKey → converter.validate → stage → apply per `on`
  //   el.selectionMode = 'range'          → reactive
  //   el.getBadgeDisplayCallback = fn     → reactive (callbacks too)

  // BATCHING: setAttributes({...}) / a batch scope coalesce many changes into one applyConfig(partial)
  setAttributes(attrs: Record<string, unknown>): void { /* … */ }

  /** Subclass hook: apply a validated partial (the component decides update-vs-reinit meaning). */
  protected abstract applyConfig(partial: Record<string, unknown>): void;
}
```

The **same pipeline serves both entry points** — attributes *and*
properties/callbacks — so everything is reactive by construction:

- **Attribute change** → `converter.fromAttribute(raw)` → stage → apply.
- **Property assignment** → `converter.validate(value)` → stage → apply.
- **Dual-path** (month-names as a pipe-string *or* an array): same row,
  `fromAttribute` handles the string, `validate` guards the array.
- **Batching** coalesces bursts into one `applyConfig`.
- **Reactivity contract** declared per input (`on`) and enforced
  centrally — no input can be added that forgets to parse, validate, or
  react.

Plus a typed `dispatch(el, name, detail, {bubbles=true, composed=true})`
and generic DOM utils (`resolveEnumAttribute`, `createMicrotaskScheduler`)
lifted from dropzone. The store/satellite topology stays dropzone-local.

---

## 7. Fit check — all five components

- **multiselect** — `{parser:'enum', enumValues}` → `toEnum(...)`;
  `bool-default-true` → `toBool('default-true')`; `setAttributes` batching
  → `BlissElement`.
- **daterangepicker** — `parseEnum(CONST)` → `toEnum(CONST)`;
  `parsePipeDelimitedList(12)` → `toList({of:'string', sep:'|', count:12})`;
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

## 11. Open questions

1. **`toText`** for the string converter (avoiding the
   `Object.prototype.toString` collision) — or prefer `toStr`?
2. **Config-key field name** — spec uses `configKey`; shorten to `key`?
3. **How much of `applyConfig`** (in-place-update vs reinit, member
   fallbacks) is generic vs stays per-component.
4. **Store/satellite pattern** — keep dropzone-local until a second
   component needs it (recommended).

---

## 12. Common functionality roadmap (to discuss — beyond v1)

Candidates already duplicated across components, in rough priority order.
Each becomes its own core module once we agree the shape.

### 12.1 Logger — DECIDED: centralize to core

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

- Core takes **`loglevel` + `loglevel-plugin-prefix` as its own npm
  dependencies** (bundled into each component's dist; **no more
  vendoring**).
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

### 12.2 Positioning — surveyed (`@floating-ui/dom`)

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

### 12.3 Other candidates (later modules)
- **Typed event dispatch** — already in v1 (`dispatch()`); components'
  event-name constants could standardize.
- **Theming / CSS cascade-layer helpers** — the `@layer` + `?inline`
  main.css import pattern (largely governed by the CSS guidelines; may
  not need runtime code).
- **CEM tooling preset** — the analyzer config + a plugin that reads the
  input table for editor metadata (ties to `custom-elements-manifest.md`;
  natural v2).
- **Testing utilities** — shared Playwright/vitest fixtures (SSR stub,
  upgrade-timing helpers, contrast checks).
```
