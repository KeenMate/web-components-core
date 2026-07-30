/**
 * A tiny, runner-agnostic event recorder for the §12.5 events model — assert
 * what a component `emit`-ted without pulling in a mocking library. Records
 * every matching event and exposes its `detail` (for `CustomEvent`s).
 */

/** The recording returned by {@link listen}. */
export interface EventSpy<E extends Event = Event> {
  /** How many matching events fired. */
  readonly count: number;
  /** Every event received, in order. */
  readonly events: readonly E[];
  /** The most recent event, or `undefined` if none fired. */
  readonly last: E | undefined;
  /** `detail` of the most recent event (for `CustomEvent`s), else `undefined`. */
  readonly lastDetail: E extends CustomEvent<infer D> ? D | undefined : unknown;
  /** Stop listening. Idempotent. */
  stop(): void;
}

/**
 * Attach a recorder for `type` on `target` and return an {@link EventSpy}. The
 * spy is live (getters read the current state), so assert after the action:
 *
 * ```ts
 * const spy = listen<CustomEvent<{ option: string }>>(el, 'select');
 * el.pick('a');
 * expect(spy.count).toBe(1);
 * expect(spy.lastDetail).toEqual({ option: 'a' });
 * spy.stop();
 * ```
 */
export function listen<E extends Event = CustomEvent>(
  target: EventTarget,
  type: string,
  options?: AddEventListenerOptions,
): EventSpy<E> {
  const events: E[] = [];
  const handler = (event: Event): void => {
    events.push(event as E);
  };
  target.addEventListener(type, handler, options);
  return {
    get count() {
      return events.length;
    },
    get events() {
      return events;
    },
    get last() {
      return events[events.length - 1];
    },
    get lastDetail() {
      const last = events[events.length - 1] as unknown as CustomEvent | undefined;
      return last?.detail;
    },
    stop() {
      target.removeEventListener(type, handler, options);
    },
  };
}
