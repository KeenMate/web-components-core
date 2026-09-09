import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerOverlay,
  notifyOverlayActivated,
  dismissAllOverlays,
  onOverlayActivated,
  OVERLAY_ACTIVATED_EVENT,
  __resetOverlays,
} from './active-overlay.js';

describe('active-overlay coordination', () => {
  afterEach(() => __resetOverlays());

  it('activating one participant dismisses the others but not itself', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const ha = registerOverlay(a);
    registerOverlay(b);
    registerOverlay(c);

    ha.activate();

    expect(a).not.toHaveBeenCalled(); // the opener keeps itself open
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('two activations in a row each dismiss the other (one-open-at-a-time)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ha = registerOverlay(a);
    const hb = registerOverlay(b);

    ha.activate();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(0);

    hb.activate();
    expect(a).toHaveBeenCalledTimes(1); // opening B closes A
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('notifyOverlayActivated() with no source dismisses everyone', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a);
    registerOverlay(b);

    notifyOverlayActivated();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('notifyOverlayActivated(source) spares a participant sharing that source token', () => {
    const token = { id: 'svelte-popover' };
    const a = vi.fn();
    registerOverlay(a);

    // External code shares the token of nobody registered → everyone dismisses.
    notifyOverlayActivated(token);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('dismissAllOverlays() closes every participant', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a);
    registerOverlay(b);

    dismissAllOverlays();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a disposed participant is no longer dismissed', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ha = registerOverlay(a);
    registerOverlay(b);

    ha.dispose();
    notifyOverlayActivated();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('external DOM dispatch (no import) drives dismissal', () => {
    const a = vi.fn();
    registerOverlay(a);

    // A Svelte/plain-DOM opener that never imported core:
    document.dispatchEvent(
      new CustomEvent(OVERLAY_ACTIVATED_EVENT, { detail: { source: 'external' } }),
    );

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('onOverlayActivated lets outside code react to KM activations', () => {
    const seen: unknown[] = [];
    const off = onOverlayActivated((source) => seen.push(source));

    const ha = registerOverlay(() => {});
    ha.activate();

    expect(seen).toHaveLength(1); // observed the KM activation, with the opener's token
    off();

    ha.activate();
    expect(seen).toHaveLength(1); // unsubscribed
  });

  it('groups coordinate independently — activating group A leaves group B open', () => {
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b1 = vi.fn();
    const ha1 = registerOverlay(a1, 'A');
    registerOverlay(a2, 'A');
    registerOverlay(b1, 'B');

    ha1.activate();

    expect(a1).not.toHaveBeenCalled(); // opener itself
    expect(a2).toHaveBeenCalledTimes(1); // same group → dismissed
    expect(b1).not.toHaveBeenCalled(); // other group → untouched
  });

  it('the ungrouped (default) group is separate from a named group', () => {
    const def = vi.fn();
    const grouped = vi.fn();
    const hDef = registerOverlay(def); // no group
    registerOverlay(grouped, 'A');

    hDef.activate();
    expect(grouped).not.toHaveBeenCalled(); // named group untouched by a default-group opener
    expect(def).not.toHaveBeenCalled();
  });

  it('notifyOverlayActivated(source, group) only dismisses that group', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a, 'A');
    registerOverlay(b, 'B');

    notifyOverlayActivated('external', 'A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('dismissAllOverlays() crosses every group; dismissAllOverlays(group) scopes', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a, 'A');
    registerOverlay(b, 'B');

    dismissAllOverlays('A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    dismissAllOverlays(); // no arg → all groups
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('activate() does not fire a participant whose dismiss disposes mid-iteration', () => {
    const order: string[] = [];
    const ha = registerOverlay(() => order.push('a'));
    // b disposes itself when dismissed — must not throw or skip c.
    const hb = registerOverlay(() => {
      order.push('b');
      hb.dispose();
    });
    registerOverlay(() => order.push('c'));

    ha.activate();
    expect(order).toEqual(['b', 'c']);
  });
});
