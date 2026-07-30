import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { normalizeEventDefs, defaultEventProperty } from './events.js';

let seq = 0;
function freshTag(): string {
  return `evt-test-${seq++}`;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('normalizeEventDefs', () => {
  it('expands bare names and resolves the default on<Name> property', () => {
    expect(normalizeEventDefs(['select', 'date-select'])).toEqual([
      { name: 'select', property: 'onSelect', bubbles: undefined, composed: undefined, cancelable: undefined },
      { name: 'date-select', property: 'onDateSelect', bubbles: undefined, composed: undefined, cancelable: undefined },
    ]);
  });

  it('honors explicit property override and property:false', () => {
    const [a, b] = normalizeEventDefs([
      { name: 'change', property: 'onValueChange' },
      { name: 'internal', property: false },
    ]);
    expect(a!.property).toBe('onValueChange');
    expect(b!.property).toBeNull();
  });

  it('defaultEventProperty PascalCases kebab names', () => {
    expect(defaultEventProperty('file-status-changed')).toBe('onFileStatusChanged');
  });
});

describe('emit', () => {
  it('dispatches a composed, bubbling CustomEvent by default', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: { option: string } }> {
      protected static override events = ['select'];
      fire(o: string): void {
        this.emit('select', { option: o });
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const outer = vi.fn();
    document.body.addEventListener('select', outer); // bubbles + composed → reaches ancestor

    el.fire('a');
    expect(outer).toHaveBeenCalledOnce();
    const evt = outer.mock.calls[0]![0] as CustomEvent<{ option: string }>;
    expect(evt.detail.option).toBe('a');
    expect(evt.bubbles).toBe(true);
    expect(evt.composed).toBe(true);
  });

  it('applies per-event dispatch overrides from the table', () => {
    const tag = freshTag();
    class El extends BlissElement<{ ping: undefined }> {
      protected static override events = [{ name: 'ping', bubbles: false }];
      fire(): void {
        this.emit('ping');
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const onEl = vi.fn();
    const onBody = vi.fn();
    el.addEventListener('ping', onEl);
    document.body.addEventListener('ping', onBody);

    el.fire();
    expect(onEl).toHaveBeenCalledOnce();
    expect(onBody).not.toHaveBeenCalled(); // bubbles:false → does not reach ancestor
  });
});

describe('managed on<Name> handler property', () => {
  it('assigning a handler registers a listener that receives the CustomEvent', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: { option: string } }> {
      protected static override events = ['select'];
      fire(o: string): void {
        this.emit('select', { option: o });
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El & { onSelect: ((e: CustomEvent) => void) | null };
    document.body.append(el as unknown as Node);

    const handler = vi.fn();
    el.onSelect = handler;
    el.fire('x');
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]![0] as CustomEvent).detail).toEqual({ option: 'x' });
    expect(el.onSelect).toBe(handler); // getter returns the bound handler
  });

  it('reassigning replaces the previous listener; null removes it', () => {
    const tag = freshTag();
    class El extends BlissElement<{ select: undefined }> {
      protected static override events = ['select'];
      fire(): void {
        this.emit('select');
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El & { onSelect: ((e: Event) => void) | null };
    document.body.append(el as unknown as Node);

    const first = vi.fn();
    const second = vi.fn();
    el.onSelect = first;
    el.onSelect = second; // replaces first
    el.fire();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    el.onSelect = null; // removes
    el.fire();
    expect(second).toHaveBeenCalledOnce();
    expect(el.onSelect).toBeNull();
  });

  it('property:false exposes the event with no managed property', () => {
    const tag = freshTag();
    class El extends BlissElement<{ internal: undefined }> {
      protected static override events = [{ name: 'internal', property: false as const }];
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    const el = document.createElement(tag) as unknown as Record<string, unknown>;
    expect('onInternal' in el).toBe(false);
  });
});

describe('on() typed subscription', () => {
  it('adds a listener and returns an unsubscribe', () => {
    const tag = freshTag();
    class El extends BlissElement<{ change: { n: number } }> {
      protected static override events = ['change'];
      fire(n: number): void {
        this.emit('change', { n });
      }
      listen(h: (e: CustomEvent<{ n: number }>) => void): () => void {
        return this.on('change', h);
      }
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);

    const el = document.createElement(tag) as unknown as El;
    document.body.append(el as unknown as Node);
    const handler = vi.fn();
    const off = el.listen(handler);
    el.fire(1);
    off();
    el.fire(2);
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]![0] as CustomEvent<{ n: number }>).detail.n).toBe(1);
  });
});

describe('runHook', () => {
  class Host extends BlissElement {
    protected static override inputs = [
      { configKey: 'beforeSelectCallback', on: 'none' as const },
    ];
    run<R>(ctx: unknown, opts: { whenUnset: R; onError?: (e: unknown) => R }): Promise<R> {
      return this.runHook('beforeSelectCallback', ctx, opts);
    }
  }
  const hostTag = freshTag();
  customElements.define(hostTag, Host as unknown as CustomElementConstructor);

  function makeHost(): Host & { beforeSelectCallback?: unknown } {
    const el = document.createElement(hostTag) as unknown as Host & { beforeSelectCallback?: unknown };
    document.body.append(el as unknown as Node);
    return el;
  }

  it('returns whenUnset when no callback is set', async () => {
    const el = makeHost();
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'accept' });
  });

  it('calls the callback with a single ctx and normalizes a sync result', async () => {
    const el = makeHost();
    el.beforeSelectCallback = (ctx: { date: number }) => ({ action: 'adjust', date: ctx.date + 1 });
    await expect(el.run({ date: 1 }, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'adjust', date: 2 });
  });

  it('awaits an async (Promise) result', async () => {
    const el = makeHost();
    el.beforeSelectCallback = async () => ({ action: 'block' });
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).resolves.toEqual({ action: 'block' });
  });

  it('routes a throw to onError when provided', async () => {
    const el = makeHost();
    el.beforeSelectCallback = () => {
      throw new Error('boom');
    };
    await expect(
      el.run({}, { whenUnset: { action: 'accept' }, onError: () => ({ action: 'restore' }) }),
    ).resolves.toEqual({ action: 'restore' });
  });

  it('re-throws when no onError is given (no silent swallow)', async () => {
    const el = makeHost();
    el.beforeSelectCallback = () => {
      throw new Error('boom');
    };
    await expect(el.run({}, { whenUnset: { action: 'accept' } })).rejects.toThrow('boom');
  });
});

describe('event-table lint (warn-only)', () => {
  it('warns on uppercase names, duplicates, and property/input collisions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tag = freshTag();
    class El extends BlissElement {
      protected static override inputs = [{ configKey: 'onSelect', on: 'none' as const }];
      protected static override events = ['Select', 'change', 'change', 'select'];
    }
    customElements.define(tag, El as unknown as CustomElementConstructor);
    document.body.append(document.createElement(tag)); // construct → validate once

    const messages = warn.mock.calls.map((c) => String(c[1] ?? c[0]));
    expect(messages.join('\n')).toMatch(/event "Select" should be lowercase/);
    expect(messages.join('\n')).toMatch(/duplicate event "change"/);
    expect(messages.join('\n')).toMatch(/property "onSelect" collides with an input configKey/);
    warn.mockRestore();
  });
});
