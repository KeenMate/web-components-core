import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock floating-ui: layout-free + deterministic (jsdom has no layout, no ResizeObserver).
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() =>
    Promise.resolve({ x: 10, y: 20, placement: 'bottom-start', strategy: 'fixed', middlewareData: {} }),
  ),
  autoUpdate: vi.fn((_ref: unknown, _float: unknown, update: () => void) => {
    update(); // fire once, like the real thing
    return vi.fn(); // cleanup
  }),
  offset: vi.fn((value: unknown) => ({ name: 'offset', value })),
  flip: vi.fn((options: unknown) => ({ name: 'flip', options })),
  shift: vi.fn((options: unknown) => ({ name: 'shift', options })),
  size: vi.fn((options: unknown) => ({ name: 'size', options })),
  arrow: vi.fn((options: unknown) => ({ name: 'arrow', options })),
  platform: { __base: true },
}));

import * as fui from '@floating-ui/dom';
import { anchor, createPopover, createTooltip, getFixedPositionOffsetParent } from './index.js';

const mw = () => (vi.mocked(fui.computePosition).mock.calls[0]![2]!.middleware ?? []) as { name: string }[];

beforeEach(() => vi.clearAllMocks());
afterEach(() => document.body.replaceChildren());

describe('anchor', () => {
  it('positions the floating element and reports the resolved placement', async () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    const onPlaced = vi.fn();

    const handle = anchor(floating, reference, { onPlaced });
    await Promise.resolve(); // let computePosition resolve

    expect(floating.style.position).toBe('fixed');
    expect(floating.style.left).toBe('10px');
    expect(floating.style.top).toBe('20px');
    expect(onPlaced).toHaveBeenCalledWith('bottom-start');

    const cleanup = vi.mocked(fui.autoUpdate).mock.results[0]!.value as ReturnType<typeof vi.fn>;
    handle.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('builds middleware in order offset → flip → shift by default', () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    anchor(floating, reference);
    expect(mw().map((m) => m.name)).toEqual(['offset', 'flip', 'shift']);
    expect(vi.mocked(fui.offset)).toHaveBeenCalledWith(4);
    expect(vi.mocked(fui.shift)).toHaveBeenCalledWith({ padding: 8 });
  });

  it('reports computed coordinates via onComputed', async () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    const onComputed = vi.fn();
    anchor(floating, reference, { onComputed });
    await Promise.resolve();
    expect(onComputed).toHaveBeenCalledWith({ x: 10, y: 20, placement: 'bottom-start' });
  });

  it('appends a size() height-cap for maxHeight and an arrow() last', () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    const arrowEl = document.createElement('div');
    anchor(floating, reference, { maxHeight: { padding: 8 }, arrow: { element: arrowEl } });
    // offset → flip → shift → size(maxHeight) → arrow
    expect(mw().map((m) => m.name)).toEqual(['offset', 'flip', 'shift', 'size', 'arrow']);
    expect(vi.mocked(fui.arrow)).toHaveBeenCalledWith({ element: arrowEl, padding: undefined });
  });

  it('passes flipPadding through to flip()', () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    anchor(floating, reference, { flipPadding: 8 });
    expect(vi.mocked(fui.flip)).toHaveBeenCalledWith({ padding: 8 });
  });

  it('forwards autoUpdateOptions to floating-ui autoUpdate', () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    anchor(floating, reference, { autoUpdateOptions: { elementResize: false } });
    expect(vi.mocked(fui.autoUpdate).mock.calls[0]![3]).toEqual({ elementResize: false });
  });

  it('adds size() for matchWidth and omits flip/shift when disabled', () => {
    anchor(document.createElement('div'), document.createElement('button'), {
      matchWidth: 'min',
      flip: false,
      shift: false,
    });
    expect(mw().map((m) => m.name)).toEqual(['offset', 'size']);
  });

  it('locks placement by feeding flip an initialPlacement fallback', () => {
    anchor(document.createElement('div'), document.createElement('button'), { lockPlacement: true });
    expect(vi.mocked(fui.flip)).toHaveBeenCalledWith({ fallbackStrategy: 'initialPlacement' });
  });

  it('skips autoUpdate but still positions when autoUpdate:false', async () => {
    anchor(document.createElement('div'), document.createElement('button'), { autoUpdate: false });
    await Promise.resolve();
    expect(vi.mocked(fui.autoUpdate)).not.toHaveBeenCalled();
    expect(vi.mocked(fui.computePosition)).toHaveBeenCalledOnce();
  });

  it('runs beforeCompute before each computePosition', async () => {
    const order: string[] = [];
    vi.mocked(fui.computePosition).mockImplementationOnce(() => {
      order.push('compute');
      return Promise.resolve({ x: 1, y: 2, placement: 'bottom-start', strategy: 'fixed', middlewareData: {} }) as never;
    });
    const beforeCompute = vi.fn(() => order.push('before'));
    anchor(document.createElement('div'), document.createElement('button'), { beforeCompute });
    await Promise.resolve();
    expect(beforeCompute).toHaveBeenCalled();
    expect(order).toEqual(['before', 'compute']);
  });

  it("lockPlacement:'freeze' pins the first resolved placement and drops flip after", async () => {
    const handle = anchor(document.createElement('div'), document.createElement('button'), { lockPlacement: 'freeze' });
    await Promise.resolve(); // first compute resolves → freeze
    const first = vi.mocked(fui.computePosition).mock.calls[0]![2]!;
    expect((first.middleware as { name: string }[]).map((m) => m.name)).toContain('flip');

    handle.update(); // next frame uses the frozen (flip-less) middleware + pinned placement
    await Promise.resolve();
    const second = vi.mocked(fui.computePosition).mock.calls[1]![2]!;
    expect((second.middleware as { name: string }[]).map((m) => m.name)).not.toContain('flip');
    expect(second.placement).toBe('bottom-start'); // the resolved placement, now pinned
  });

  it('inherits data-theme from the nearest themed ancestor (C-CS-10)', () => {
    const root = document.createElement('div');
    root.setAttribute('data-theme', 'dark');
    const reference = document.createElement('button');
    root.append(reference);
    document.body.append(root);
    const floating = document.createElement('div');

    anchor(floating, reference, { inheritThemeFrom: reference });
    expect(floating.getAttribute('data-theme')).toBe('dark');
  });

  it('fixedContainingBlock resolves the offset parent from the FLOATING element', () => {
    const floatingCB = document.createElement('div'); // a transformed ancestor of the floating panel
    const floating = document.createElement('div');
    floatingCB.append(floating);
    const reference = document.createElement('button'); // has NO transformed ancestor
    document.body.append(floatingCB, reference);
    // Only the floating's ancestor establishes a fixed CB; the reference's chain is clean.
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el) =>
        ({ transform: el === floatingCB ? 'scale(1.05)' : 'none', perspective: 'none', filter: 'none', willChange: '' }) as unknown as CSSStyleDeclaration,
    );

    anchor(floating, reference, { fixedContainingBlock: true });
    const plat = vi.mocked(fui.computePosition).mock.calls[0]![2]!.platform as unknown as { getOffsetParent: () => unknown };
    // Resolves from `floating` (→ floatingCB), NOT from `reference` (which would give window).
    expect(plat.getOffsetParent()).toBe(floatingCB);
    spy.mockRestore();
  });

  it('an explicit platform wins over fixedContainingBlock', () => {
    const platform = { getOffsetParent: vi.fn() } as unknown as import('./types.js').Platform;
    anchor(document.createElement('div'), document.createElement('button'), { platform, fixedContainingBlock: true });
    expect(vi.mocked(fui.computePosition).mock.calls[0]![2]!.platform).toBe(platform);
  });

  it('onDrift reports when the panel lands away from where it was positioned', async () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    // computePosition (mocked) writes x:10/y:20, but the panel actually renders at 100/100.
    floating.getBoundingClientRect = () =>
      ({ x: 100, y: 100, top: 100, left: 100, right: 100, bottom: 100, width: 0, height: 0, toJSON() {} }) as DOMRect;
    const onDrift = vi.fn();

    anchor(floating, reference, { onDrift });
    await Promise.resolve();

    expect(onDrift).toHaveBeenCalledOnce();
    const report = onDrift.mock.calls[0]![0] as { driftX: number; driftY: number };
    expect(report.driftX).toBeCloseTo(90);
    expect(report.driftY).toBeCloseTo(80);
  });

  it('onDrift does not fire when the panel is on target', async () => {
    const floating = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(floating, reference);
    floating.getBoundingClientRect = () =>
      ({ x: 10, y: 20, top: 20, left: 10, right: 10, bottom: 20, width: 0, height: 0, toJSON() {} }) as DOMRect;
    const onDrift = vi.fn();

    anchor(floating, reference, { onDrift });
    await Promise.resolve();

    expect(onDrift).not.toHaveBeenCalled();
  });
});

describe('createTooltip', () => {
  it('shows on mouseenter and hides on mouseleave, toggling the visible class', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const tip = createTooltip({ trigger, content: 'hi', cssClass: 'tt' });

    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    await Promise.resolve();
    expect(tip.isVisible).toBe(true);
    expect(tip.element.classList.contains('is-visible')).toBe(true);
    expect(tip.element.textContent).toBe('hi');
    expect(tip.element.className).toContain('tt');
    expect(document.body.contains(tip.element)).toBe(true);

    trigger.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.isVisible).toBe(false);
    expect(document.body.contains(tip.element)).toBe(false);
    tip.destroy();
  });

  it('respects a show delay', () => {
    vi.useFakeTimers();
    try {
      const trigger = document.createElement('button');
      document.body.append(trigger);
      const tip = createTooltip({ trigger, content: 'hi', delay: { show: 200 } });

      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      expect(tip.isVisible).toBe(false); // still waiting
      vi.advanceTimersByTime(200);
      expect(tip.isVisible).toBe(true);
      tip.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('followCursor anchors to a moving virtual element', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const tip = createTooltip({ trigger, content: 'hi', followCursor: true });

    tip.show();
    await Promise.resolve();
    // the reference passed to computePosition is the virtual element (has getBoundingClientRect, no nodeType)
    const ref = vi.mocked(fui.computePosition).mock.calls[0]![0] as { getBoundingClientRect: () => DOMRect };
    expect(typeof ref.getBoundingClientRect).toBe('function');

    trigger.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 7 }));
    const rect = ref.getBoundingClientRect();
    expect(rect.x).toBe(5);
    expect(rect.y).toBe(7);
    tip.destroy();
  });

  it('calls onBeforeShow right before showing', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const onBeforeShow = vi.fn();
    const tip = createTooltip({ trigger, content: 'hi', onBeforeShow });
    tip.show();
    expect(onBeforeShow).toHaveBeenCalledOnce();
    expect(tip.isVisible).toBe(true);
    tip.destroy();
  });

  it('mounts into a ShadowRoot container', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const trigger = document.createElement('button');
    shadow.append(trigger);
    const tip = createTooltip({ trigger, content: 'hi', container: shadow });
    tip.show();
    expect(shadow.contains(tip.element)).toBe(true);
    tip.destroy();
  });

  it('destroy removes the trigger listeners', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const tip = createTooltip({ trigger, content: 'hi' });
    tip.destroy();
    trigger.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip.isVisible).toBe(false); // listener gone
  });
});

describe('createPopover', () => {
  it('opens (mounts + anchors) and closes (unmounts)', async () => {
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    document.body.append(reference);

    const pop = createPopover({ reference, panel, matchWidth: 'exact' });
    expect(pop.isOpen).toBe(false);

    pop.open();
    await Promise.resolve();
    expect(pop.isOpen).toBe(true);
    expect(document.body.contains(panel)).toBe(true);
    expect(vi.mocked(fui.size)).toHaveBeenCalled(); // matchWidth → size()
    expect(vi.mocked(fui.computePosition).mock.calls[0]![2]!.placement).toBe('bottom-start');

    pop.close();
    expect(pop.isOpen).toBe(false);
    expect(document.body.contains(panel)).toBe(false);
  });

  it('is idempotent on double open/close', () => {
    const pop = createPopover({ reference: document.createElement('button'), panel: document.createElement('div') });
    pop.open();
    pop.open();
    expect(vi.mocked(fui.autoUpdate)).toHaveBeenCalledOnce();
    pop.close();
    pop.close();
  });

  it('forwards beforeCompute, platform, flip/shift, and lockPlacement:freeze to anchor', async () => {
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    document.body.append(reference);
    const beforeCompute = vi.fn();
    const platform = { getOffsetParent: vi.fn() } as unknown as import('./types.js').Platform;

    const pop = createPopover({
      reference,
      panel,
      beforeCompute,
      platform,
      shift: 12,
      lockPlacement: 'freeze',
    });
    pop.open();
    await Promise.resolve();

    // beforeCompute runs before positioning; the custom platform reaches computePosition.
    expect(beforeCompute).toHaveBeenCalled();
    expect(vi.mocked(fui.computePosition).mock.calls[0]![2]!.platform).toBe(platform);
    // freeze flips on the first frame like a normal flip (no fallbackStrategy).
    expect(vi.mocked(fui.flip)).toHaveBeenCalledWith({});
    expect(vi.mocked(fui.shift)).toHaveBeenCalledWith({ padding: 12 });

    pop.close();
  });

  it('disables flip when flip:false', () => {
    const pop = createPopover({ reference: document.createElement('button'), panel: document.createElement('div'), flip: false });
    pop.open();
    expect(vi.mocked(fui.flip)).not.toHaveBeenCalled();
    pop.close();
  });
});

describe('getFixedPositionOffsetParent', () => {
  // jsdom's getComputedStyle is unreliable for `transform`, so stub it to control
  // exactly which element establishes a fixed-positioning containing block.
  const stubStyles = (has: (el: Element) => boolean) =>
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el) => ({ transform: has(el as Element) ? 'scale(1.05)' : 'none', perspective: 'none', filter: 'none', willChange: '' }) as unknown as CSSStyleDeclaration,
    );

  it('never returns the element itself (an element is not its own containing block)', () => {
    const parent = document.createElement('div');
    const child = document.createElement('div');
    parent.append(child);
    document.body.append(parent);
    // ONLY the child has a transform — it must be skipped, resolving to the viewport.
    const spy = stubStyles((el) => el === child);
    expect(getFixedPositionOffsetParent(child)).toBe(window);
    spy.mockRestore();
  });

  it('returns the nearest ancestor that establishes a containing block', () => {
    const grand = document.createElement('div');
    const parent = document.createElement('div');
    const child = document.createElement('div');
    grand.append(parent);
    parent.append(child);
    document.body.append(grand);
    const spy = stubStyles((el) => el === parent);
    expect(getFixedPositionOffsetParent(child)).toBe(parent);
    spy.mockRestore();
  });
});
