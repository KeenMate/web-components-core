# @keenmate/web-components-core

The shared foundation for KeenMate's web components. It consolidates the
custom-element plumbing that five shipping components (`web-multiselect`,
`web-daterangepicker`, `web-treeview`, `web-dropzone`, `web-grid`) each used to
re-implement — a reactive input model, a base element class, converters,
categorized logging, and the `window.components` global — into one package so
that correctness lives in a single place and can't drift.

> **[`docs/SPEC.md`](docs/SPEC.md) is the source of truth** for design intent. This
> README is the tour; read the relevant SPEC section before changing behavior.

## What's New in v1.0.0-rc10

- **Cross-component overlay coordination — one popover open at a time, across frameworks.**
  New `registerOverlay` / `notifyOverlayActivated` / `dismissAllOverlays` / `onOverlayActivated`
  (and the `ALL_GROUPS` wildcard) let floating overlays dismiss each other when one opens — every
  KM component *and* any external popover (a Svelte component, a plain-DOM widget, another
  framework). Everything routes through one `document` CustomEvent `km-overlay-activated` carrying
  `{ source, group }`, so outside code can both trigger dismissal and be dismissed *without*
  importing core. An optional `group` scopes coordination, so two independent sets of controls stay
  separate; ungrouped overlays share one default group. SSR-safe (no-op without a `document`).

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

## What's New in v1.0.0-rc09

- **`viewportChanged(env)` — a throttled, continuous viewport-size hook.** The
  environment observable now splits by cadence: `environmentChanged` fires only on
  *discrete* flips (breakpoint, orientation, pointer/hover), while the new
  `viewportChanged` streams live `viewportWidth`/`viewportHeight` changes throttled
  to ~30 ms (leading + trailing) — for a layout that reflows *within* a device
  class, e.g. a desktop window shrinking narrow. Opt-in and zero-cost unless you
  override it.
- **`resized(size)` + `observeElementSize(el, cb)` — per-element size reactivity.**
  Reflow to the component's *own box*, not the window (a picker in a narrow sidebar
  on a wide monitor). One shared page-wide `ResizeObserver` fans out to every
  subscriber; fires the real border box after connect, then on changes, throttled
  and deduped. Prefer CSS container queries for *presentational* reflow — reach for
  `resized()` when the reflow is *structural* (a different number of rendered
  children, a `reinit()` input).
- **`environmentChanged` no longer wakes on raw window resizes.** Viewport width/
  height left its equality gate, so a desktop drag-resize that crosses no
  breakpoint stops firing it ~60×/s. Move live-width logic to `viewportChanged`.

See [`CHANGELOG.md`](CHANGELOG.md) for the full list.

## Install

```
npm install @keenmate/web-components-core
```

Runtime dependencies: a single one — **`@floating-ui/dom`**, used only by the
`/positioning` subpath, so it stays out of the base import graph unless you
position. The logging engine is vendored (no `loglevel` dependency).

## The two load-bearing ideas

### 1. One reactive input table

Every public input — attribute, complex property, or callback — is a single
`InputDef` row. There is **no central switch statement**: dispatch is just
`def.converter.fromAttribute(raw)`. A new input type is a new converter created
anywhere (core or a component), never a core edit.

```ts
import { BlissElement, toEnum, toInt, toText, toFunction, type InputDef } from '@keenmate/web-components-core';

const INPUTS: readonly InputDef[] = [
  { configKey: 'selectionMode', attribute: 'selection-mode',
    converter: toEnum(['single', 'multiple'], { default: 'single' }), on: 'reinit' },
  { configKey: 'maxHeight', attribute: 'max-height',
    converter: toText({ default: '20rem' }), on: 'update' },
  { configKey: 'minSearchLength', attribute: 'min-search-length',
    converter: toInt({ min: 0, default: 1 }), on: 'update' },
  // property-only (no attribute): callbacks and rich data
  { configKey: 'getValueCallback', converter: toFunction(), on: 'reinit' },
];
```

Each row declares **what a change triggers** via `on`:

- `update` — patch in place (default)
- `reinit` — requires a full rebuild
- `none` — store only, don't react (e.g. event callbacks)

### 2. The `Converter<V>` owns parsing *and* validation

One converter per input handles the attribute path (`fromAttribute`: raw string
→ validated `V`), the property path (`validate`: is this JS-assigned value
acceptable?), and optional reflection (`toAttribute`). Correctness lives in one
place so it can't drift across the three spots it used to.

The `to*` factory library sets both paths from the same inputs:

| factory | for |
| --- | --- |
| `toEnum(values, { default?, shouldNullOnInvalid? })` | fixed string set |
| `toInt({ min?, max?, default? })` / `toFloat(...)` | numbers |
| `toText({ shouldTrim?, isEmptyAllowed?, isNullable?, default? })` | strings (`isNullable` → optional string, absent/empty ⇒ `null`) |
| `toBool('presence' \| 'default-true' \| 'default-false' \| 'tristate')` | booleans |
| `toBytes({ default? })` | human sizes (`"10mb"`) |
| `toList({ itemType?, separator?, requiredCount?, shouldTrim?, default? })` | delimited lists |
| `toCustom(parse, { validate?, toAttribute? })` | bespoke parsers |
| `toFunction()` | property-only callbacks |
| `toValue({ validate?, default? })` | rich value (property = validate, attribute = JSON) |
| `toObjectArray({ validateItem?, default? })` | array of rich items (e.g. `options`); default `[]` |
| `toObject({ validate?, default? })` | plain non-array object |

> Boolean options follow the house convention (`is`/`should`/`has`/`can`
> prefixes): `shouldTrim`, `isEmptyAllowed`, `isNullable`, `shouldNullOnInvalid`.

## `BlissElement` — the base class

`BlissElement` wires both entry points (attribute + property) through the *same*
pipeline, so everything is reactive by construction. It is SSR-safe, computes
`observedAttributes` from the input table, coalesces bursts into a single update,
and provides typed event dispatch. The input table is **opt-in** — a subclass
without `static inputs` still gets the SSR-safe base plus typed events (`emit()` /
`on()`), which is how `web-grid` uses it while keeping its own config-object API.

```ts
class WebMultiSelect extends BlissElement {
  protected static override inputs = INPUTS;

  protected override reinit() { /* full rebuild — reads this.config */ }
  protected override update(partial: Record<string, unknown>) { /* patch just the changed keys */ }
  protected override connect() { /* start listeners / observers / timers */ }
  protected override disconnect() { /* stop what connect() started */ }
}
```

**Lifecycle** (build-once + activate/deactivate, Lit's model):

- **`reinit()`** — first connect, and any batch touching an `on: 'reinit'` input.
  In a mixed batch, reinit dominates (it rebuilds from full `this.config`, so the
  `update` partial is suppressed).
- **`update(partial)`** — a batch with only `on: 'update'` changes.
- **`connect()` / `disconnect()`** — every connect/disconnect, for live
  resources. A DOM move re-activates **without rebuilding**, so transient UI
  state survives. Keep them balanced.

Batch many changes into one reinit/update with `setAttributes({ ... })` or
`batch(() => { ... })`. To await the pipeline deterministically — in a test or
before reading rendered state — use **`await el.whenSettled()`**: it resolves
once every staged change has flushed and its `reinit()`/`update()` has run
(immediately when nothing is pending).

## Environment & presentation (device / viewport / orientation)

Components that swap a floating panel for a fullscreen sheet (or a modal) on
smaller devices share one signal instead of each re-deriving "what is a phone."

**React to the device** by overriding `environmentChanged(env)` — the base
subscribes on connect and unsubscribes on disconnect (no listeners unless you
override it), fires immediately with the current snapshot, then on every
pointer / hover / orientation / viewport change. For a one-off synchronous read,
call `getEnvironment()`.

**Classify, then present — two separate concerns:**

- **`classifyDevice(env)` → `'mobile' | 'tablet' | 'desktop'`** is the *shared*
  classification every component must agree on. **Capability decides first:** a
  non-touch device is always `desktop` at *any* width — so a **narrowed desktop
  window keeps its floating dropdown, never a fullscreen sheet**. Only touch
  devices consult the 600px short-side line (`mobile` below it, `tablet` at/above).
  This is a different axis from the width-only `env.breakpoint` (a landscape iPad
  is `breakpoint: 'desktop'` yet `deviceClass: 'tablet'`).
- **`resolvePresentation(mode, env, map?)` → `'floating' | 'modal' | 'fullscreen'`**
  is the *per-component policy*. `mode` is the author setting (`'auto'` |
  `'floating'` | `'modal'` | `'fullscreen'`); a forced value wins, and `'auto'`
  classifies the device and looks it up in `map`, falling back per-class to
  `DEFAULT_PRESENTATION_MAP` (`mobile → fullscreen`, tablet/desktop → `floating`).
  You list only the classes you change:

```ts
protected override environmentChanged(env: EnvironmentSnapshot) {
  // "on a tablet, use a modal" — phone & desktop keep the defaults:
  this.setPresentation(resolvePresentation(this.mode, env, { tablet: 'modal' }));
}
```

**Need a rule *finer* than the class** — e.g. "desktop, but under 800px show a
modal"? The `map` is class-keyed, so drop to `classifyDevice(env)` and read the
current width off the snapshot yourself (`env.viewportWidth`):

```ts
protected override environmentChanged(env: EnvironmentSnapshot) {
  if (this.mode !== 'auto') return this.setPresentation(this.mode);
  const cls = classifyDevice(env);
  this.setPresentation(
    cls === 'mobile'        ? 'fullscreen' :
    cls === 'tablet'        ? 'modal'      :
    env.viewportWidth < 800 ? 'modal'      :   // desktop, narrow
                              'floating',      // desktop, wide
  );
}
```

Rule of thumb: **class-only policy → `resolvePresentation(mode, env, map)`;
width-aware → `classifyDevice(env)` + your own branch.** For the fullscreen tier,
`lockBodyScroll()` and `observeKeyboardInset(panel)` handle page-scroll locking
and keeping the sheet above the soft keyboard. See [SPEC §12.9](docs/SPEC.md) for
the full rationale (why 600px, capability over width, the deprecated
`resolveMobilePresentation`).

## Global registration (`window.components`)

`registerComponent` replaces the block every component used to copy-paste (and
drift). It defines the element, publishes build metadata + logging controls to
`window.components[tag]`, and wires `getInstances()` to the live-instance
registry `BlissElement` maintains automatically (added on connect, removed on
disconnect — a DOM move re-tracks without duplicating).

```ts
import { registerComponent, createLoggers } from '@keenmate/web-components-core';

const logging = createLoggers('MULTISELECT'); // categories: INIT / DATA / UI

registerComponent('web-multiselect', WebMultiSelect, {
  config: { name: '@keenmate/web-multiselect', version: '1.0.0', author: 'KeenMate' },
  logging,                 // optional — flattened onto the global entry
  // shouldAutoDefine: true (default) — also exposes an idempotent register()
});
```

From anywhere (console, a devtools overlay, server-rendered code):

```js
window.components['web-multiselect'].getInstances()        // live elements on the page
window.components['web-multiselect'].version()             // build version
window.components['web-multiselect'].logging.enableLogging()
```

The returned elements **are** the per-instance handles — enumerate tags with
`getRegisteredTags()`, each tag's instances with `getInstances(tag)`.

## Logging

`createLoggers(namespace, categories?)` returns categorized
`NAMESPACE:CATEGORY` loggers over `loglevel`, each with a color-coded prefix.
Categories default to `INIT / DATA / UI` (redefinable / extendable).
`enableLogging()` / `disableLogging()` / `setLogLevel()` / `setCategoryLevel()`
control the whole bundle (i.e. all instances of that component type).

### Per-instance logging

`BlissElement` also exposes **`this.log`** — an instance logger per category,
gated by the *more verbose* of the type-level level and this element's own
override, and emitted via `console` directly. This lets a devtools overlay make
**one element loud while its type stays silent**:

```ts
protected override update(partial: Record<string, unknown>) {
  this.log.DATA?.debug('update', Object.keys(partial));
}
```

```js
el.enableLogging();        // this element only — even while the type is silent
el.disableLogging();
el.isLoggingEnabled;       // boolean
```

Each line is prefixed with a `tag#id` handle — the element's own `id` when set,
else a `tag#n` counter:

```
[MULTISELECT:DATA] web-multiselect#country-picker  update  ['maxHeight']
[MULTISELECT:DATA] web-multiselect#1               update  ['searchPlaceholder']
```

> ### ⚠️ Logging caveat: the instance label is memoized
>
> The `tag#id` handle is computed **once, on first access to `this.log`**, and
> cached for the element's lifetime. In practice the element's `id` is set in
> markup before its first lifecycle log, so the label reflects it correctly.
>
> But if the `id` attribute is **assigned later** — after the element has already
> logged once — the label keeps the value it had at first access (the counter, if
> there was no `id` then). The *element reference* returned by `getInstances()` is
> always the reliable handle; the string label is a convenience for reading the
> console. Set the `id` before the element first logs (i.e. in markup / before
> connection) if you want it to appear in the label.

## Style injection

Two zero-dep helpers (main index) for the shadow-root CSS plumbing components
re-roll. Core owns the *injection*, not the authoring rules (`@layer` order,
Vite `?inline`) — and stays render-agnostic, so these are free functions, not
base-class methods.

```ts
import { adoptStyles, createStyleSlot } from '@keenmate/web-components-core';
import styles from './main.css?inline';

// static, shared across all instances (one cached CSSStyleSheet; <style> fallback)
adoptStyles(this.shadowRoot, styles);

// per-instance user CSS (the customStylesCallback pattern) — one replaceable slot
const slot = createStyleSlot(this.shadowRoot, { className: 'custom-styles' });
slot.set(this.config.customStylesCallback?.());  // re-set replaces; falsy clears
```

## Positioning (`@keenmate/web-components-core/positioning`)

Floating-element positioning over a single pinned `@floating-ui/dom` — one
low-level `anchor()` primitive plus `createTooltip()` and `createPopover()`
presets, replacing the ~15 hand-rolled call sites across the components. A
separate subpath, so `@floating-ui/dom` is only pulled in when you position.

```ts
import { createPopover, createTooltip } from '@keenmate/web-components-core/positioning';

// dropdown/panel — portaled to <body>, width-matched, keeps the theme
const dropdown = createPopover({ reference: input, panel, matchWidth: 'min' });
dropdown.open();   // mount + position + autoUpdate
dropdown.close();  // unmount + stop

// tooltip — hover/focus with a delay; followCursor: true to track the pointer
const tip = createTooltip({ trigger, content: 'Help text', delay: { show: 200 } });
```

`anchor(floating, reference, opts)` returns `{ update, destroy }`; options:
`placement` (default `'bottom-start'`), `strategy` (default `'fixed'`), `offset`,
`flip`, `shift`, `matchWidth: 'min' | 'exact'`, `lockPlacement`, `autoUpdate`,
`inheritThemeFrom` (copies `data-theme` onto portaled layers — C-CS-10), and a
`platform` escape hatch.

## Testing (`@keenmate/web-components-core/testing`)

Runner-agnostic DOM fixtures (pure DOM, zero deps — vitest+jsdom or a real
browser). Pair them with `await el.whenSettled()` to await the reactive pipeline.

```ts
import { mount, cleanup, listen, uniqueTag, defineOnce } from '@keenmate/web-components-core/testing';

afterEach(cleanup);

it('emits select when picked', async () => {
  const tag = defineOnce(uniqueTag(), MyElement);
  const el = mount<MyElement>(`<${tag} selection-mode="multiple"></${tag}>`);
  const spy = listen(el, 'select');
  el.pick('a');
  await el.whenSettled();
  expect(spy.lastDetail).toEqual({ option: 'a' });
});
```

`mount` / `cleanup`, `mountBeforeUpgrade` (pre-upgrade property capture),
`uniqueTag` / `defineOnce`, `nextTick` / `nextFrame`, and `listen` → an
`EventSpy` (`count` / `events` / `last` / `lastDetail` / `stop()`).

## Editor metadata (`@keenmate/web-components-core/cem`)

A [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest)
analyzer plugin that reads the `static inputs` / `static events` tables, so the
manifest — and the HTML autocomplete/hover editors build from it — is generated
from the single source of truth: **structure** from each row + its converter
(attribute↔property, type, default, `reflect`, enum members), **prose** from
optional `description` / `deprecated` fields on the row. Build-time only.

```js
// custom-elements-manifest.config.js
import { blissAnalyzerConfig } from '@keenmate/web-components-core/cem';
export default blissAnalyzerConfig();
```

```ts
// a row carries its own help text — no @attr re-declaration to drift
{ configKey: 'selectionMode', attribute: 'selection-mode',
  converter: toEnum(['single', 'multiple'], { default: 'single' }),
  description: 'Whether the user can pick one option or several.' }
```

## Commands

```
npm test            # vitest run (jsdom) — the whole suite
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/ (ESM + .d.ts), excludes *.test.ts
```

Tests (`*.test.ts`) live next to the code they cover. Source uses explicit `.js`
extensions on relative imports (moduleResolution `Bundler`) and
`verbatimModuleSyntax` (type-only imports must use `import type`).

## Learn more

- **[`docs/reactivity-and-batching.md`](docs/reactivity-and-batching.md)** — how
  the pipeline coalesces bursts, `reinit()` vs `update()`, how many times a
  component rebuilds, and the mass-update tools (`setAttributes` / `batch`).
- **[`docs/SPEC.md`](docs/SPEC.md)** — full design intent, the per-component
  divergence this consolidates, and the decisions log.
- **`CHANGELOG.md`** — what's landed.

## License

MIT
