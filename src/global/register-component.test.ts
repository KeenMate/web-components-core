import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { createLoggers } from '../logging/create-loggers.js';
import { getInstances, getRegisteredTags } from './instances.js';
import { registerComponent } from './register-component.js';

let seq = 0;
/** A fresh tag per test so the global registry / customElements never collide. */
function freshTag(): string {
  return `reg-test-${seq++}`;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('registerComponent', () => {
  it('publishes to window.components and auto-defines the element', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: '@keenmate/x', version: '1.2.3', author: 'KM' },
    });

    expect(window.components?.[tag]).toBe(entry);
    expect(entry.version()).toBe('1.2.3');
    expect(entry.config.author).toBe('KM');
    expect(customElements.get(tag)).toBe(El); // auto-defined
  });

  it('shouldAutoDefine:false leaves the element undefined until register()', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '0.0.0' },
      shouldAutoDefine: false,
    });
    expect(customElements.get(tag)).toBeUndefined();
    entry.register();
    expect(customElements.get(tag)).toBe(El);
  });

  it('flattens a LoggerBundle into logging controls', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const logging = createLoggers('REGTEST', ['INIT', 'DATA']);
    const spy = vi.spyOn(logging, 'setCategoryLevel');
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging,
    });

    expect(entry.logging?.getCategories()).toEqual(['INIT', 'DATA']);
    entry.logging?.setCategoryLevel('DATA', 'debug');
    expect(spy).toHaveBeenCalledWith('DATA', 'debug');
  });

  it('omits logging when no bundle is supplied', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    const entry = registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });
    expect(entry.logging).toBeUndefined();
  });
});

describe('live-instance registry', () => {
  it('tracks instances on connect and drops them on disconnect', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });

    expect(getInstances(tag)).toEqual([]);

    const a = document.createElement(tag);
    const b = document.createElement(tag);
    document.body.append(a, b);
    expect(getInstances(tag)).toEqual([a, b]);
    expect(window.components?.[tag]?.getInstances()).toEqual([a, b]);
    expect(getRegisteredTags()).toContain(tag);

    a.remove();
    expect(getInstances(tag)).toEqual([b]);
    b.remove();
    expect(getInstances(tag)).toEqual([]);
    expect(getRegisteredTags()).not.toContain(tag);
  });

  it('per-instance logging: enableLogging() makes only that element loud', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const tag = freshTag();
    // Expose this.log through a tiny method so the test can drive it.
    class El extends BlissElement {
      shout(): void {
        this.log.DATA!.debug('hi');
      }
    }
    const logging = createLoggers('PERINST', ['DATA']);
    logging.disableLogging(); // type-level silent
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
      logging,
    });

    const a = document.createElement(tag) as unknown as El & { shout(): void; enableLogging(): void; disableLogging(): void };
    const b = document.createElement(tag) as unknown as El & { shout(): void };
    document.body.append(a as unknown as Node, b as unknown as Node);

    a.shout();
    b.shout();
    expect(spy).not.toHaveBeenCalled(); // type silent, no overrides

    a.enableLogging(); // overlay picks element a
    a.shout();
    b.shout();
    expect(spy).toHaveBeenCalledOnce(); // only a
    expect(spy.mock.calls[0]![0]!).toMatch(new RegExp(`^%c\\[PERINST:DATA\\]%c ${tag}#\\d+$`));

    a.disableLogging();
    a.shout();
    expect(spy).toHaveBeenCalledOnce(); // back to silent
  });

  it('a DOM move re-tracks the same instance without duplicating it', () => {
    const tag = freshTag();
    class El extends BlissElement {}
    registerComponent(tag, El as unknown as CustomElementConstructor, {
      config: { name: 'x', version: '1' },
    });
    const host1 = document.createElement('div');
    const host2 = document.createElement('div');
    document.body.append(host1, host2);

    const el = document.createElement(tag);
    host1.append(el);
    expect(getInstances(tag)).toEqual([el]);
    host2.append(el); // move: disconnect then reconnect
    expect(getInstances(tag)).toEqual([el]);
  });
});
