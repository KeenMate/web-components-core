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

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BlissElement', () => {
  it('derives observedAttributes from the table (property-only inputs excluded)', () => {
    expect(TestElement.observedAttributes).toEqual([
      'selection-mode',
      'option-height',
      'placeholder',
      'disabled',
      'internal-id',
      'note',
    ]);
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

describe('define', () => {
  it('is idempotent', () => {
    expect(() => {
      define('test-element', TestElement as unknown as CustomElementConstructor);
      define('test-element', TestElement as unknown as CustomElementConstructor);
    }).not.toThrow();
    expect(customElements.get('test-element')).toBe(TestElement);
  });
});
