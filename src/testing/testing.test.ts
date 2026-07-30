import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from '../element/bliss-element.js';
import { toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';
import { cleanup, defineOnce, listen, mount, mountBeforeUpgrade, uniqueTag } from './index.js';

class Widget extends BlissElement<{ ping: { n: number } }> {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  protected static override events = ['ping'];
  reinits = 0;
  connects = 0;
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override connect(): void {
    this.connects += 1;
  }
  firePing(n: number): void {
    this.emit('ping', { n });
  }
}

/** A fresh subclass per tag — jsdom rejects registering one constructor under two tags. */
const freshWidget = (): CustomElementConstructor => class extends Widget {} as unknown as CustomElementConstructor;

afterEach(cleanup);

describe('uniqueTag / defineOnce', () => {
  it('uniqueTag returns distinct valid tags', () => {
    const a = uniqueTag('w');
    const b = uniqueTag('w');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^w-\d+$/);
  });

  it('defineOnce does not throw on a repeat define', () => {
    const tag = uniqueTag();
    const ctor = freshWidget();
    defineOnce(tag, ctor);
    expect(() => defineOnce(tag, ctor)).not.toThrow();
  });
});

describe('mount', () => {
  it('mounts an HTML string, connects it, and returns the element', async () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    const el = mount<Widget>(`<${tag} height="20"></${tag}>`);
    expect(el.connects).toBe(1); // connected → connect() ran
    await el.whenSettled();
    expect(el.reinits).toBe(1);
    expect((el as unknown as Record<string, unknown>).height).toBe(20);
  });

  it('cleanup removes mounted elements', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    mount(`<${tag}></${tag}>`);
    expect(document.querySelector(tag)).not.toBeNull();
    cleanup();
    expect(document.querySelector(tag)).toBeNull();
  });
});

describe('mountBeforeUpgrade', () => {
  it('captures properties set before the class is defined', async () => {
    const tag = uniqueTag();
    const el = mountBeforeUpgrade<Widget>(
      tag,
      freshWidget(),
      (e) => {
        e.height = 33; // set while still a plain HTMLElement
      },
    );
    await el.whenSettled();
    expect((el as unknown as Record<string, unknown>).height).toBe(33); // routed through the setter on upgrade
    expect(el.reinits).toBe(1);
  });
});

describe('listen', () => {
  it('records emitted CustomEvents and exposes the latest detail', () => {
    const tag = defineOnce(uniqueTag(), freshWidget());
    const el = mount<Widget>(`<${tag}></${tag}>`);
    const spy = listen<CustomEvent<{ n: number }>>(el, 'ping');

    el.firePing(1);
    el.firePing(2);
    expect(spy.count).toBe(2);
    expect(spy.lastDetail).toEqual({ n: 2 });
    expect(spy.events.map((e) => e.detail.n)).toEqual([1, 2]);

    spy.stop();
    el.firePing(3);
    expect(spy.count).toBe(2); // stopped
  });
});
