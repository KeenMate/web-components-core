// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { define } from './define.js';
import { toEnum, toInt } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

class SsrElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'mode', attribute: 'mode', converter: toEnum(['a', 'b'] as const, { default: 'a' }) },
    { configKey: 'size', attribute: 'size', converter: toInt({ default: 10 }) },
  ];
  read(): Readonly<Record<string, unknown>> {
    return this.config;
  }
}

describe('SSR (no DOM present)', () => {
  it('runs in an environment without HTMLElement / customElements', () => {
    expect(typeof HTMLElement).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
  });

  it('constructs and seeds converter defaults without a DOM', () => {
    const el = new SsrElement();
    expect(el.read()).toEqual({ mode: 'a', size: 10 });
    expect(SsrElement.observedAttributes).toEqual(['mode', 'size', 'dir']);
  });

  it('define() is a no-op (does not throw) when customElements is absent', () => {
    expect(() => define('ssr-element', SsrElement as unknown as CustomElementConstructor)).not.toThrow();
  });
});
