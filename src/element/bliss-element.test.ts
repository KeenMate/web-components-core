import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { dispatch } from './dispatch.js';
import { define } from './define.js';
import { toBool, toEnum, toFunction, toInt, toText } from '../inputs/converters.js';
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
  readonly updates: Record<string, unknown>[] = [];
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push(partial);
  }
  peek(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}

define('test-element', TestElement as unknown as CustomElementConstructor);

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

  it('ignores invalid property assignments', async () => {
    const el = new TestElement();
    document.body.appendChild(el);
    el.reinits = 0;
    el.updates.length = 0;

    (el as unknown as { selectionMode: string }).selectionMode = 'bogus';
    await tick();
    expect(el.peek().selectionMode).toBe('single'); // unchanged
    expect(el.updates).toHaveLength(0);
    expect(el.reinits).toBe(0);
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
