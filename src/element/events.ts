/**
 * The event side of the callback/event model (SPEC §12.5). A component declares
 * its outward notifications in a `static events` table; `BlissElement.emit()`
 * dispatches them (typed against the map) and installs a managed `on<Name>`
 * handler PROPERTY per event — assigning it (de)registers a real listener, so
 * `el.onSelect = e => …` behaves exactly like `addEventListener('select', …)`
 * and receives the same `CustomEvent`. Contrast with `*Callback` inputs, which
 * shape behavior and go through `runHook` (return value honored).
 */

/** Compile-time map of event name → its `CustomEvent.detail` type. */
export type EventMap = Record<string, unknown>;

/** One declared outward event. A bare string is shorthand for `{ name }`. */
export interface EventDef<D = unknown> {
  /** Dispatched name, kebab or bare — e.g. `'select'`, `'date-select'`. */
  name: string;
  /** Phantom detail type carrier; unused at runtime. */
  detail?: D;
  /**
   * The managed handler property to install (`el.onSelect = …`). Defaults to
   * `on` + PascalCase(name). Set `false` to expose the event without a property.
   */
  property?: string | false;
  /** Per-event dispatch overrides (else the `dispatch()` defaults: bubbles+composed). */
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
}

/** An `EventDef` with its property name resolved (`null` = no managed property). */
export interface NormalizedEventDef {
  name: string;
  property: string | null;
  bubbles?: boolean;
  composed?: boolean;
  cancelable?: boolean;
}

/** `date-select` → `DateSelect`; `change` → `Change`. */
function pascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

/** The default managed-property name for an event: `on` + PascalCase(name). */
export function defaultEventProperty(name: string): string {
  return `on${pascal(name)}`;
}

/** Expand the `static events` shorthand into resolved defs (property names filled in). */
export function normalizeEventDefs(
  events: readonly (string | EventDef)[] | undefined,
): NormalizedEventDef[] {
  if (!events) return [];
  return events.map((entry) => {
    const def: EventDef = typeof entry === 'string' ? { name: entry } : entry;
    const property = def.property === false ? null : (def.property ?? defaultEventProperty(def.name));
    return { name: def.name, property, bubbles: def.bubbles, composed: def.composed, cancelable: def.cancelable };
  });
}
