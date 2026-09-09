/**
 * Cross-component "one overlay open at a time" coordination.
 *
 * Floating overlays across every KM component (multiselect dropdown, daterangepicker
 * calendar, a future menu, …) — and any *external* popover (a Svelte component, a
 * plain-DOM widget, another framework) — cooperate so that opening one dismisses all
 * the others. There is exactly one coordination channel: a `document` CustomEvent
 * `km-overlay-activated` (namespaced like `km-log`), carrying `{ source, group }`.
 * Everyone routes through it, so **nothing has to import this module to participate**
 * — pure DOM code can both trigger and observe the same behaviour.
 *
 * ## Groups
 * Overlays coordinate only *within a group*. Register with a `group` to scope a set of
 * controls so they dismiss each other but leave other groups untouched — e.g. a toolbar
 * of pickers that shouldn't close a sidebar of pickers. Overlays registered with no
 * group share the default (ungrouped) group. Opening a group-`A` overlay dismisses only
 * other group-`A` overlays. {@link dismissAllOverlays}() (no argument) crosses every
 * group via the {@link ALL_GROUPS} wildcard.
 *
 * Direction A — dismiss KM overlays from outside code:
 *   document.dispatchEvent(new CustomEvent('km-overlay-activated', { detail: { source: myId, group: 'A' } }))
 *   // or, if you import core: notifyOverlayActivated(myId, 'A')
 *
 * Direction B — have your own popover dismissed when a KM overlay opens:
 *   document.addEventListener('km-overlay-activated', (e) => {
 *     const { source, group } = e.detail;
 *     if (source !== myId && group === myGroup) closeMyPopover();
 *   })
 *   // or, if you import core: onOverlayActivated((source, group) => { … })
 *
 * `source` is an opaque identity used only for `===` self-comparison so an opener never
 * dismisses itself. Registered participants get a private token automatically; external
 * callers pass their own (a string, an object, anything).
 *
 * SSR-safe: with no `document`, registration still works but activation is a no-op.
 */

/** The single coordination event. `detail` is an {@link OverlayActivatedDetail}. */
export const OVERLAY_ACTIVATED_EVENT = 'km-overlay-activated';

/** Wildcard group: an activation carrying it dismisses overlays in *every* group. */
export const ALL_GROUPS = Symbol('km-overlay-all-groups');

/** Detail payload of {@link OVERLAY_ACTIVATED_EVENT}. */
export interface OverlayActivatedDetail {
  /** Opaque identity of the overlay that opened; peers with a different source dismiss. */
  source: unknown;
  /** Coordination group; only same-group overlays dismiss (or all when {@link ALL_GROUPS}). */
  group: unknown;
}

/** Handle returned by {@link registerOverlay}. */
export interface OverlayHandle {
  /** This overlay opened: broadcast so every *other* overlay in its group dismisses. */
  activate(): void;
  /** This overlay closed: clears the active marker for its group if it was this one. */
  deactivate(): void;
  /** Stop participating (call on disconnect/destroy). */
  dispose(): void;
}

interface Participant {
  /** Private per-registration identity, used as the event `source` on activate. */
  readonly id: object;
  /** Coordination group (default `undefined` — the ungrouped group). */
  readonly group: unknown;
  /** Called when another overlay in the same group activates (or a dismiss is requested). */
  readonly dismiss: () => void;
}

const participants = new Set<Participant>();
/** group → the currently-active participant in that group (introspection only). */
const active = new Map<unknown, Participant>();
/** Installed lazily on first registration; removed when the last participant disposes. */
let listening = false;

function hasDocument(): boolean {
  return typeof document !== 'undefined';
}

/** An activation in `eventGroup` dismisses a participant in `participantGroup` when they match. */
function groupMatches(participantGroup: unknown, eventGroup: unknown): boolean {
  return eventGroup === ALL_GROUPS || participantGroup === eventGroup;
}

/** The single document listener: dismiss same-group participants whose id ≠ the opener's source. */
function onActivated(e: Event): void {
  const detail = (e as CustomEvent<OverlayActivatedDetail>).detail;
  const source = detail?.source;
  const group = detail?.group;
  // Snapshot: a dismiss handler may dispose (mutating the set) mid-iteration.
  for (const p of Array.from(participants)) {
    if (p.id !== source && groupMatches(p.group, group)) p.dismiss();
  }
}

function ensureListening(): void {
  if (listening || !hasDocument()) return;
  document.addEventListener(OVERLAY_ACTIVATED_EVENT, onActivated);
  listening = true;
}

function stopListeningIfIdle(): void {
  if (listening && participants.size === 0 && hasDocument()) {
    document.removeEventListener(OVERLAY_ACTIVATED_EVENT, onActivated);
    listening = false;
  }
}

/** Broadcast the coordination event. No-op without a `document` (SSR). */
function broadcast(source: unknown, group: unknown): void {
  if (!hasDocument()) return;
  document.dispatchEvent(
    new CustomEvent<OverlayActivatedDetail>(OVERLAY_ACTIVATED_EVENT, { detail: { source, group } }),
  );
}

/**
 * Register an overlay as a participant. `onDismiss` runs when another overlay in the
 * same `group` opens (or a dismiss is requested) — make it idempotent (a closed overlay
 * closing again should be a no-op). `group` scopes coordination (default: ungrouped).
 * Returns a handle to drive activation.
 */
export function registerOverlay(onDismiss: () => void, group?: unknown): OverlayHandle {
  const participant: Participant = { id: {}, group, dismiss: onDismiss };
  participants.add(participant);
  ensureListening();

  return {
    activate(): void {
      active.set(participant.group, participant);
      // Route through the event so external listeners see KM activations too; the shared
      // listener dismisses every *other* same-group participant (source === our id).
      broadcast(participant.id, participant.group);
    },
    deactivate(): void {
      if (active.get(participant.group) === participant) active.delete(participant.group);
    },
    dispose(): void {
      participants.delete(participant);
      if (active.get(participant.group) === participant) active.delete(participant.group);
      stopListeningIfIdle();
    },
  };
}

/**
 * Framework-agnostic trigger for non-registered code (Svelte, plain DOM, …): announce
 * that an overlay opened so all registered/listening overlays in `group` except `source`
 * dismiss. Pass your own stable `source` to avoid dismissing yourself; pass a `group`
 * (default: ungrouped) to scope it, or {@link ALL_GROUPS} to hit every group.
 */
export function notifyOverlayActivated(source?: unknown, group?: unknown): void {
  broadcast(source, group);
}

/**
 * Dismiss registered/listening overlays right now (e.g. route change, modal open). With
 * no argument it crosses every group; pass a `group` to dismiss just that group.
 */
export function dismissAllOverlays(group?: unknown): void {
  broadcast(undefined, arguments.length === 0 ? ALL_GROUPS : group);
}

/**
 * Subscribe to overlay activations (typed sugar over the DOM event). The handler gets
 * the opener's `source` and `group`; compare them to your own to decide whether to
 * close. Returns an unsubscribe function. No-op without a `document`.
 */
export function onOverlayActivated(handler: (source: unknown, group: unknown) => void): () => void {
  if (!hasDocument()) return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OverlayActivatedDetail>).detail;
    handler(detail?.source, detail?.group);
  };
  document.addEventListener(OVERLAY_ACTIVATED_EVENT, listener);
  return () => document.removeEventListener(OVERLAY_ACTIVATED_EVENT, listener);
}

/** Test-only: drop all participants and detach the listener. */
export function __resetOverlays(): void {
  participants.clear();
  active.clear();
  if (listening && hasDocument()) {
    document.removeEventListener(OVERLAY_ACTIVATED_EVENT, onActivated);
  }
  listening = false;
}
