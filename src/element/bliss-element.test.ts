import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { dispatch } from './dispatch.js';
import { define } from './define.js';
import { toBool, toCustom, toEnum, toFunction, toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

const SELECTION = ['single', 'multiple', 'range'] as const;

class TestElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'selectionMode', attribute: 'selection-mode', converter: toEnum(SELECTION, { default: 'single' }) },
    { configKey: 'optionHeight', attribute: 'option-height', converter: toInt({ min: 1, default: 50 }), on: 'reinit' },
    { configKey: 'placeholder', attribute: 'placeholder', converter: toText({ default: 'Search...' }) },
    { configKey: 'disabled', attribute: 'disabled', converter: toBool('presence'), reflect: true },
    { configKey: 'internalId', attribute: 'internal-id', converter: toText({ default: '' }), field: '_id' },
    { configKey: 'onPick', converter: toFunction(), on: 'update' },
    { configKey: 'note', attribute: 'note', converter: toText({ default: '' }), on: 'none' },
  ];

  reinits = 0;
  connects = 0;
  disconnects = 0;
  readonly updates: Record<string, unknown>[] = [];
  readonly events: string[] = [];
  readonly dirChanges: boolean[] = [];
  protected override directionChanged(isRTL: boolean): void {
    this.dirChanges.push(isRTL);
  }
  protected override reinit(): void {
    this.reinits += 1;
    this.events.push('reinit');
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push(partial);
    this.events.push('update');
  }
  protected override connect(): void {
    this.connects += 1;
    this.events.push('connect');
  }
  protected override disconnect(): void {
    this.disconnects += 1;
    this.events.push('disconnect');
  }
  peek(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}

define('test-element', TestElement as unknown as CustomElementConstructor);

class ThrowingElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    {
      configKey: 'bad',
      attribute: 'bad',
      converter: toCustom(() => {
        throw new Error('boom');
      }),
    },
  ];
}
define('throwing-element', ThrowingElement as unknown as CustomElementConstructor);

// Each malformed table is used by exactly one test — validation runs once per class.
class DupKeyElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'a', attribute: 'a', converter: toText() },
    { configKey: 'a', attribute: 'b', converter: toText() },
  ];
}
class DupAttrElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'a', attribute: 'x', converter: toText() },
    { configKey: 'b', attribute: 'x', converter: toText() },
  ];
}
class ReflectNoAttrElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'a', converter: toText(), reflect: true },
  ];
}
class ReflectNoToAttrElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'a', attribute: 'a', converter: toCustom((raw) => raw), reflect: true },
  ];
}
class ValidTableElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'a', attribute: 'a', converter: toText() },
    { configKey: 'b', attribute: 'b', converter: toBool('presence'), reflect: true },
  ];
}
[DupKeyElement, DupAttrElement, ReflectNoAttrElement, ReflectNoToAttrElement, ValidTableElement].forEach(
  (ctor, i) => define(`table-element-${i}`, ctor as unknown as CustomElementConstructor),
);

class ReflectElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'count', attribute: 'count', converter: toInt({ default: 0 }), reflect: true },
    { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const, { default: 'a' }), reflect: true },
  ];
  updates = 0;
  protected override update(): void {
    this.updates += 1;
  }
}
define('reflect-element', ReflectElement as unknown as CustomElementConstructor);

// Unusual: a subclass that claims `dir` as its own input attribute. It must take
// the normal parse/stage/react path — NOT the always-observed directionChanged hook.
class DirInputElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'dir', attribute: 'dir', converter: toText({ default: '' }), on: 'update' },
  ];
  readonly updates: Record<string, unknown>[] = [];
  readonly dirChanges: boolean[] = [];
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push(partial);
  }
  protected override directionChanged(isRTL: boolean): void {
    this.dirChanges.push(isRTL);
  }
  peek(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}
define('dir-input-element', DirInputElement as unknown as CustomElementConstructor);

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BlissElement', () => {
  it('derives observedAttributes from the table (property-only inputs excluded), plus the always-observed dir', () => {
    expect(TestElement.observedAttributes).toEqual([
      'selection-mode',
      'option-height',
      'placeholder',
      'disabled',
      'internal-id',
      'note',
      'dir',
    ]);
  });

  it('fires directionChanged on a post-connect dir change, not on the initial attribute', async () => {
    const el = document.createElement('test-element') as TestElement;
    // Initial `dir` set before connect is consumed by the first build — no hook.
    el.setAttribute('dir', 'rtl');
    document.body.appendChild(el);
    await tick();
    expect(el.dirChanges).toEqual([]);

    // Post-connect changes fire the hook once each.
    el.setAttribute('dir', 'ltr');
    expect(el.dirChanges.length).toBe(1);
    el.setAttribute('dir', 'rtl');
    expect(el.dirChanges.length).toBe(2);
    expect(typeof el.dirChanges[0]).toBe('boolean');
  });

  it('routes dir through the input pipeline (not directionChanged) when declared as an input attribute', async () => {
    // `dir` listed once (deduped), not appended a second time.
    expect(DirInputElement.observedAttributes).toEqual(['dir']);

    const el = document.createElement('dir-input-element') as DirInputElement;
    document.body.appendChild(el);
    await tick();

    el.setAttribute('dir', 'rtl');
    await tick();
    // The declared input wins: config updated, update() called, hook NOT fired.
    expect(el.peek().dir).toBe('rtl');
    expect(el.updates).toEqual([{ dir: 'rtl' }]);
    expect(el.dirChanges).toEqual([]);
  });

  it('seeds converter defaults into config at construction', () => {
    const el = new TestElement();
    expect(el.peek()).toMatchObject({ selectionMode: 'single', optionHeight: 50, placeholder: 'Search...', disabled: false });
  });

  it('mirrors a backing field when `field` is set', () => {
    const el = new TestElement();
    el.setAttribute('internal-id', 'abc');
    document.body.appendChild(el);
    expect((el as unknown as { _id: string })._id).toBe('abc');
  });

  it('calls reinit() once on first connect (full initial build)', () => {
    const el = new TestElement();
    el.setAttribute('selection-mode', 'multiple');
    document.body.appendChild(el);
    expect(el.reinits).toBe(1);
    expect(el.updates).toHaveLength(0);
    // full config is available to reinit() via this.config
    expect(el.peek()).toMatchObject({ selectionMode: 'multiple', placeholder: 'Search...' });
  });

  it('patches update-only changes via update() with just the changed keys', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    el.setAttribute('selection-mode', 'range');
    el.setAttribute('placeholder', 'Find');
    expect(el.updates).toHaveLength(0); // batched
    await tick();
    expect(el.reinits).toBe(0);
    expect(el.updates).toHaveLength(1);
    expect(el.updates[0]).toEqual({ selectionMode: 'range', placeholder: 'Find' });
  });

  it('calls reinit() (not update) when a reinit-level key changes', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    el.setAttribute('option-height', '30'); // on: 'reinit'
    await tick();
    expect(el.reinits).toBe(1);
    expect(el.updates).toHaveLength(0);
  });

  it('reinit absorbs update keys when a batch mixes both', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    el.setAttributes({ selectionMode: 'range', placeholder: 'Find', optionHeight: 15 });
    expect(el.reinits).toBe(1); // one reinit
    expect(el.updates).toHaveLength(0); // update partial suppressed
    expect(el.peek()).toMatchObject({ selectionMode: 'range', placeholder: 'Find', optionHeight: 15 });
  });

  it('reacts to property assignment through the validate path', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    (el as unknown as { selectionMode: string }).selectionMode = 'multiple';
    await tick();
    expect(el.peek().selectionMode).toBe('multiple');
    expect(el.updates[0]).toEqual({ selectionMode: 'multiple' });
  });

  it('ignores invalid property assignments and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    (el as unknown as { selectionMode: string }).selectionMode = 'bogus';
    await tick();
    expect(el.peek().selectionMode).toBe('single'); // unchanged
    expect(el.updates).toHaveLength(0);
    expect(el.reinits).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('rejected invalid value for property "selectionMode"');
    warn.mockRestore();
  });

  it('treats callbacks as reactive property-only update inputs', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;
    const fn = (): void => {};

    (el as unknown as { onPick: () => void }).onPick = fn;
    await tick();
    expect(el.peek().onPick).toBe(fn);
    expect(el.updates[0]).toEqual({ onPick: fn });
  });

  it('coalesces setAttributes into a single update', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    el.setAttributes({ selectionMode: 'range', placeholder: 'Find' });
    expect(el.updates).toHaveLength(1);
    expect(el.updates[0]).toEqual({ selectionMode: 'range', placeholder: 'Find' });
  });

  it('reflects a property to its attribute', () => {
    const el = new TestElement();
    document.body.appendChild(el);

    (el as unknown as { disabled: boolean }).disabled = true;
    expect(el.hasAttribute('disabled')).toBe(true);
    (el as unknown as { disabled: boolean }).disabled = false;
    expect(el.hasAttribute('disabled')).toBe(false);
  });

  it("stores 'none'-reactivity inputs without calling reinit or update", async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    el.setAttribute('note', 'hello');
    await tick();
    expect(el.peek().note).toBe('hello');
    expect(el.reinits).toBe(0);
    expect(el.updates).toHaveLength(0);
  });

  it('warns and falls back to default when a converter throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = new ThrowingElement(); // seedDefaults triggers the throwing converter
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain('threw computing its default');
    expect((el as unknown as { bad: unknown }).bad).toBeUndefined(); // fell back to (absent) default
    warn.mockRestore();
  });
});

describe('BlissElement batching', () => {
  it('batch() coalesces all changes into one update', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.updates.length = 0;

    el.batch(() => {
      (el as unknown as { selectionMode: string }).selectionMode = 'range';
      (el as unknown as { placeholder: string }).placeholder = 'x';
    });

    expect(el.updates).toHaveLength(1);
    expect(el.updates[0]).toEqual({ selectionMode: 'range', placeholder: 'x' });
  });

  it('coalesces a property + an attribute change in one microtask (last value wins)', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.updates.length = 0;

    (el as unknown as { placeholder: string }).placeholder = 'first';
    el.setAttribute('placeholder', 'second');
    await tick();

    expect(el.updates).toHaveLength(1);
    expect(el.updates[0]).toEqual({ placeholder: 'second' });
  });

  it('flush() applies a pending property write synchronously (imperative-method ordering)', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.updates.length = 0;

    // A loose property write coalesces on a microtask...
    (el as unknown as { placeholder: string }).placeholder = 'x';
    expect(el.updates).toHaveLength(0);

    // ...but flush() applies it right now, before the next synchronous statement.
    el.flush();
    expect(el.updates).toHaveLength(1);
    expect(el.updates[0]).toEqual({ placeholder: 'x' });
  });

  it('flush() is a no-op when nothing is pending', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.updates.length = 0;

    el.flush();
    expect(el.updates).toHaveLength(0);
  });
});

describe('BlissElement reflection', () => {
  it('reflects non-boolean property values to attribute strings', () => {
    const el = new ReflectElement();
    document.body.appendChild(el);
    (el as unknown as { count: number }).count = 42;
    (el as unknown as { mode: string }).mode = 'b';
    expect(el.getAttribute('count')).toBe('42');
    expect(el.getAttribute('mode')).toBe('b');
  });

  it('does not double-process a reflected change (no attribute feedback loop)', async () => {
    const el = new ReflectElement();
    document.body.appendChild(el);
    el.updates = 0;

    (el as unknown as { count: number }).count = 7;
    await tick();

    expect(el.updates).toBe(1); // exactly one — the reflected setAttribute did not re-stage
    expect(el.getAttribute('count')).toBe('7');
  });

  it('captures a property assigned before upgrade', () => {
    class PreUpgradeElement extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const, { default: 'a' }) },
      ];
      read(): Readonly<Record<string, unknown>> {
        return this.config;
      }
    }
    const el = document.createElement('pre-upgrade-element');
    (el as unknown as { mode: string }).mode = 'b'; // own property, before define/upgrade
    define('pre-upgrade-element', PreUpgradeElement as unknown as CustomElementConstructor);
    customElements.upgrade(el);

    expect((el as unknown as { mode: string }).mode).toBe('b'); // routed through the setter
    expect((el as PreUpgradeElement).read()).toMatchObject({ mode: 'b' });
  });

  it('lets a pre-upgrade property win over the initial attribute, then reacts to later attribute changes', async () => {
    class DualPathElement extends BlissElement {
      protected static override inputs: readonly InputDef[] = [
        { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const, { default: 'a' }) },
      ];
      read(): Readonly<Record<string, unknown>> {
        return this.config;
      }
    }
    const el = document.createElement('dualpath-element');
    el.setAttribute('mode', 'a'); // initial attribute (would clobber without the guard)
    (el as unknown as { mode: string }).mode = 'b'; // pre-upgrade property — should win
    define('dualpath-element', DualPathElement as unknown as CustomElementConstructor);
    customElements.upgrade(el);
    document.body.appendChild(el);
    await tick();

    // Property assigned before upgrade wins over the replayed initial attribute.
    expect((el as DualPathElement).read()).toMatchObject({ mode: 'b' });

    // But a genuine attribute change after connect still reacts.
    el.setAttribute('mode', 'a');
    await tick();
    expect((el as DualPathElement).read()).toMatchObject({ mode: 'a' });
  });
});

describe('BlissElement lifecycle (build-once + activate/deactivate)', () => {
  it('calls connect() after reinit() on first connect', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    expect(el.events).toEqual(['reinit', 'connect']);
    expect(el.connects).toBe(1);
  });

  it('calls disconnect() on removal', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.events.length = 0;
    document.body.removeChild(el);
    expect(el.events).toEqual(['disconnect']);
    expect(el.disconnects).toBe(1);
  });

  it('re-activates on reconnect WITHOUT rebuilding (a DOM move)', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.events.length = 0;
    el.reinits = 0;

    document.body.removeChild(el); // disconnect
    document.body.appendChild(el); // reconnect

    expect(el.events).toEqual(['disconnect', 'connect']);
    expect(el.reinits).toBe(0); // no rebuild on move
    expect(el.connects).toBe(2);
  });

  it('applies config changed while disconnected, then re-activates (update → connect)', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.events.length = 0;
    el.reinits = 0;
    el.updates.length = 0;

    document.body.removeChild(el);
    el.setAttribute('selection-mode', 'range'); // on:'update', while detached
    document.body.appendChild(el);

    expect(el.events).toEqual(['disconnect', 'update', 'connect']);
    expect(el.peek().selectionMode).toBe('range');
  });

  it('rebuilds on reconnect when a reinit-level input changed while disconnected', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.events.length = 0;
    el.reinits = 0;

    document.body.removeChild(el);
    el.setAttribute('option-height', '30'); // on:'reinit', while detached
    document.body.appendChild(el);

    expect(el.events).toEqual(['disconnect', 'reinit', 'connect']);
    expect(el.reinits).toBe(1);
  });
});

describe('BlissElement table validation (warn-only, once per class)', () => {
  const tableWarnings = (warn: ReturnType<typeof vi.spyOn>): string[] =>
    warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('invalid input table'));

  it('warns on duplicate configKey', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new DupKeyElement();
    expect(tableWarnings(warn).some((m) => m.includes('duplicate configKey "a"'))).toBe(true);
    warn.mockRestore();
  });

  it('warns on duplicate attribute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new DupAttrElement();
    expect(tableWarnings(warn).some((m) => m.includes('duplicate attribute "x"'))).toBe(true);
    warn.mockRestore();
  });

  it('warns on reflect:true without an attribute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new ReflectNoAttrElement();
    expect(tableWarnings(warn).some((m) => m.includes('no attribute to reflect to'))).toBe(true);
    warn.mockRestore();
  });

  it('warns on reflect:true without converter.toAttribute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new ReflectNoToAttrElement();
    expect(tableWarnings(warn).some((m) => m.includes('has no toAttribute'))).toBe(true);
    warn.mockRestore();
  });

  it('does not warn on a valid table', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new ValidTableElement();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('validates a class only once, not per instance', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new DupKeyElement(); // already validated in the first test — no repeat warning
    expect(tableWarnings(warn)).toHaveLength(0);
    warn.mockRestore();
  });
});

describe('dispatch', () => {
  it('emits a composed, bubbling CustomEvent by default', () => {
    const el = new TestElement();
    document.body.appendChild(el);
    const handler = vi.fn();
    el.addEventListener('picked', handler);

    dispatch(el, 'picked', { id: 7 });
    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0]![0] as CustomEvent<{ id: number }>;
    expect(evt.detail).toEqual({ id: 7 });
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(true);
  });
});

class FormEl extends BlissElement {
  static formAssociated = true;
}
define('form-el', FormEl as unknown as CustomElementConstructor);

describe('BlissElement form association', () => {
  it('exposes internals lazily and memoizes the same object (attachInternals called once)', () => {
    const el = new FormEl();
    const spy = vi.spyOn(el, 'attachInternals');
    const a = (el as unknown as { internals: ElementInternals | null }).internals;
    const b = (el as unknown as { internals: ElementInternals | null }).internals;
    expect(a).not.toBeNull();
    expect(b).toBe(a); // memoized
    expect(spy).toHaveBeenCalledTimes(1); // attachInternals may run at most once
  });

  it('form getter reads through ElementInternals.form', () => {
    const el = new FormEl();
    const form = document.createElement('form');
    // jsdom does not wire real form association, so model it via attachInternals.
    vi.spyOn(el, 'attachInternals').mockReturnValue({ form } as unknown as ElementInternals);
    expect(el.form).toBe(form);
  });

  it('form is null when not inside a form', () => {
    const el = new FormEl();
    document.body.appendChild(el);
    expect(el.form).toBeNull(); // internals.form is undefined → null
    el.remove();
  });

  it('degrades to null when attachInternals is unavailable (SSR / older jsdom)', () => {
    const el = new FormEl();
    Object.defineProperty(el, 'attachInternals', { value: undefined, configurable: true });
    expect((el as unknown as { internals: ElementInternals | null }).internals).toBeNull();
    expect(el.form).toBeNull();
  });
});

class EnvElement extends BlissElement {
  readonly envSnapshots: Array<{ breakpoint: string; os: string }> = [];
  protected override environmentChanged(env: { breakpoint: string; os: string }): void {
    this.envSnapshots.push({ breakpoint: env.breakpoint, os: env.os });
  }
}
define('env-element', EnvElement as unknown as CustomElementConstructor);

class PlainElement extends BlissElement {}
define('plain-element', PlainElement as unknown as CustomElementConstructor);

describe('environmentChanged hook', () => {
  it('fires on connect for an element that overrides the hook', () => {
    const el = document.createElement('env-element') as EnvElement;
    document.body.appendChild(el);
    expect(el.envSnapshots.length).toBe(1);
    expect(el.envSnapshots[0]).toHaveProperty('breakpoint');
    expect(el.envSnapshots[0]).toHaveProperty('os');
  });

  it('re-subscribes across a disconnect/reconnect (DOM move)', () => {
    const el = document.createElement('env-element') as EnvElement;
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    expect(el.envSnapshots.length).toBe(2);
  });

  it('does not fire (or attach) for an element that leaves the hook as the no-op default', () => {
    // The base must not subscribe when environmentChanged is not overridden.
    const el = document.createElement('plain-element') as PlainElement;
    expect(() => {
      document.body.appendChild(el);
      el.remove();
    }).not.toThrow();
    expect(
      (el as unknown as { environmentChanged: unknown }).environmentChanged,
    ).toBe(BlissElement.prototype['environmentChanged' as keyof BlissElement]);
  });
});

class ViewportElement extends BlissElement {
  count = 0;
  protected override viewportChanged(): void {
    this.count++;
  }
}
define('viewport-element', ViewportElement as unknown as CustomElementConstructor);

describe('viewportChanged hook', () => {
  it('fires immediately on connect for an overriding element', () => {
    const el = document.createElement('viewport-element') as ViewportElement;
    document.body.appendChild(el);
    expect(el.count).toBe(1);
    el.remove();
  });

  it('re-subscribes across a disconnect/reconnect (DOM move)', () => {
    const el = document.createElement('viewport-element') as ViewportElement;
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    expect(el.count).toBe(2);
    el.remove();
  });

  it('does not attach for an element that leaves the hook as the no-op default', () => {
    const el = document.createElement('plain-element') as PlainElement;
    expect(() => {
      document.body.appendChild(el);
      el.remove();
    }).not.toThrow();
    expect((el as unknown as { viewportChanged: unknown }).viewportChanged).toBe(
      BlissElement.prototype['viewportChanged' as keyof BlissElement],
    );
  });
});

// A minimal controllable ResizeObserver — jsdom ships none.
class MockRO {
  static instances: MockRO[] = [];
  readonly cb: ResizeObserverCallback;
  readonly observed = new Set<Element>();
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockRO.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  emit(...els: Element[]): void {
    this.cb(els.map((target) => ({ target }) as unknown as ResizeObserverEntry), this as unknown as ResizeObserver);
  }
}

class SizedElement extends BlissElement {
  readonly widths: number[] = [];
  protected override resized(size: { width: number; height: number }): void {
    this.widths.push(size.width);
  }
}
define('sized-element', SizedElement as unknown as CustomElementConstructor);

describe('resized hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes the element on connect and fires on a box change (not before layout)', () => {
    MockRO.instances = [];
    vi.stubGlobal('ResizeObserver', MockRO);
    const el = document.createElement('sized-element') as SizedElement;
    el.getBoundingClientRect = () => ({ width: 300, height: 100 }) as DOMRect;
    document.body.appendChild(el);
    // immediate:false → no pre-layout fire; the observer is watching this element.
    expect(el.widths).toEqual([]);
    const ro = MockRO.instances[MockRO.instances.length - 1]!;
    expect(ro.observed.has(el)).toBe(true);
    ro.emit(el); // real laid-out box delivered
    expect(el.widths).toEqual([300]);
    el.remove();
  });

  it('unobserves on disconnect', () => {
    MockRO.instances = [];
    vi.stubGlobal('ResizeObserver', MockRO);
    const el = document.createElement('sized-element') as SizedElement;
    el.getBoundingClientRect = () => ({ width: 300, height: 100 }) as DOMRect;
    document.body.appendChild(el);
    const ro = MockRO.instances[MockRO.instances.length - 1]!;
    el.remove();
    expect(ro.observed.has(el)).toBe(false);
  });

  it('does not observe for an element that leaves the hook as the no-op default', () => {
    MockRO.instances = [];
    vi.stubGlobal('ResizeObserver', MockRO);
    const el = document.createElement('plain-element') as PlainElement;
    document.body.appendChild(el);
    // No observer is created at all when nothing overrides resized.
    expect(MockRO.instances).toHaveLength(0);
    expect((el as unknown as { resized: unknown }).resized).toBe(BlissElement.prototype['resized' as keyof BlissElement]);
    el.remove();
  });
});

describe('define', () => {
  it('is idempotent', () => {
    expect(() => {
      define('test-element', TestElement as unknown as CustomElementConstructor);
      define('test-element', TestElement as unknown as CustomElementConstructor);
    }).not.toThrow();
    expect(customElements.get('test-element')).toBe(TestElement);
  });
});
