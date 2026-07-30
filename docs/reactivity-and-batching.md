# Reactivity & batching — how many times does it rebuild?

`BlissElement` routes **every** input change — whether an HTML attribute or a
JS property — through one pipeline, coalesces bursts, and then calls **exactly
one** of two subclass hooks per batch. This doc explains that flow and, in
particular, how to control how many times a component rebuilds.

## The two hooks

| hook | when | gets |
| --- | --- | --- |
| **`reinit()`** | first connect, and any batch that changes an `on: 'reinit'` input | nothing — it reads the full, already-merged `this.config` and rebuilds |
| **`update(partial)`** | a batch that changes only `on: 'update'` inputs | just the changed keys |

A batch that touches **any** `on: 'reinit'` input calls `reinit()` **only** — the
rebuild reads full `this.config`, so it already absorbs any `update`-level keys
that changed in the same batch (the `update` partial is suppressed). `on: 'none'`
inputs are stored but never trigger either hook.

## The pipeline (why bursts collapse)

```
attribute change ─┐
                  ├─► parse / validate ─► stage ─► (coalesce) ─► reinit() | update(partial)
property assign  ─┘
```

- An **attribute** change runs `converter.fromAttribute(raw)`.
- A **property** assignment runs `converter.validate(value)` (rejected values
  warn and keep the previous value), and reflects to an attribute if the input
  declares `reflect: true`.
- Either way the resolved value is **staged**: written into `this.config`, and —
  unless it's `on: 'none'` — added to a pending set with a **microtask** flush
  scheduled. Multiple stages in the same tick schedule the *same* microtask, so
  they collapse into **one** flush.
- **`flush()` holds until connected** (`if (!isConnected) return`) *before* it
  clears the pending state — so changes made while detached are preserved and
  applied on the next connect.

## How many reinits? — the `#hroch` walkthrough

```html
<web-multiselect id="hroch"></web-multiselect>
```
```js
const el = document.getElementById('hroch');
el.options = [...];
el.valueMember = 'code';
el.displayValueMember = 'name';
// … set every option …
```

**Answer: 2 reinits — and the number of properties is irrelevant.**

1. **On connect.** The element is parsed from markup, so it connects
   immediately. First connect is always a full build → `reinit()` runs once with
   an **all-defaults** config (`id` isn't an input).
2. **The JS batch.** Each assignment stages its value and schedules a microtask;
   every assignment in the same synchronous block collapses into **one** flush.
   That flush touches `on: 'reinit'` inputs → **one** `reinit()`, whether you set
   3 options or 50.

### Caveat: coalescing is per-tick
The collapse only holds *within a single JS tick*. If you spread assignments
across `await`s or separate event handlers, each tick that touches a reinit
input is its own reinit.

## Mass update — make the batch explicit

`setAttributes(values)` and `batch(fn)` apply many inputs as **one** flush, and
they **force a synchronous flush** — so they don't depend on everything landing
in the same tick the way loose property assignments do.

```js
// object form — keys may be configKeys OR kebab attribute names
el.setAttributes({
  options: [...],
  valueMember: 'code',          // configKey
  'display-value-member': 'name', // …or the attribute name
});

// callback form — set via property assignments inside the function
el.batch(() => {
  el.options = [...];
  el.valueMember = 'code';
});
```

Both run one `reinit()` (if any key is `on: 'reinit'`) or one `update(partial)`
with all the changed `on: 'update'` keys. **One call = one flush.** (So N
separate `setAttributes` calls = N flushes — pass one object, not several calls.)

## Getting it down to a single reinit

The "2" above is one throwaway defaults-build on connect plus your batch. To pay
for the build **once**, configure **before** attaching — changes staged while
detached are held and applied by the first connect:

```js
const el = document.createElement('web-multiselect');
el.id = 'hroch';
el.setAttributes({ options: [...], valueMember: 'code', /* … */ });
// (or loose property assignments, or batch(); all fine while detached)
document.body.appendChild(el);   // ONE reinit, with the full config — no wasted defaults build
```

| pattern | reinits |
| --- | --- |
| in markup, then configure (any style) | **2** — defaults on connect + your batch |
| create detached → configure → append | **1** — full config on first connect |
| loose `el.x = …` assignments, same tick | collapse to **1** flush |
| loose assignments across ticks/`await`s | **1 per tick** that hits a reinit input |
| `setAttributes({…})` / `batch(fn)` | **1** flush per call, tick-independent |

## Related behavior

- **Removing an attribute is reactive**: it resets that input to its `default`
  (absent == default), staged and flushed like any other change.
- **DOM moves don't rebuild**: a reorder/re-parent fires `disconnect()` then
  `connect()` and re-activates **without** `reinit()` (which runs only on first
  connect or an `on: 'reinit'` change), so transient UI state survives. Config
  changed while detached is applied on reconnect, before `connect()`.

See **`SPEC.md` §6 / §11 decision 3** for the design rationale.
