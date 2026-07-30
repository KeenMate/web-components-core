import { afterEach, describe, expect, it } from 'vitest';
import { BlissElement } from './bliss-element.js';
import { toInt, toText } from '../inputs/converters.js';
import type { InputDef } from '../inputs/types.js';

let seq = 0;
const freshTag = (): string => `settle-test-${seq++}`;

class SettleElement extends BlissElement {
  protected static override inputs: readonly InputDef[] = [
    { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }), on: 'reinit' },
    { configKey: 'label', attribute: 'label', converter: toText({ default: '' }), on: 'update' },
  ];
  reinits = 0;
  readonly updates: Record<string, unknown>[] = [];
  protected override reinit(): void {
    this.reinits += 1;
  }
  protected override update(partial: Record<string, unknown>): void {
    this.updates.push(partial);
  }
}

function makeEl(): SettleElement & Record<string, unknown> {
  const tag = freshTag();
  class El extends SettleElement {} // fresh subclass — one constructor per tag
  customElements.define(tag, El as unknown as CustomElementConstructor);
  return document.createElement(tag) as unknown as SettleElement & Record<string, unknown>;
}

afterEach(() => document.body.replaceChildren());

describe('whenSettled', () => {
  it('resolves immediately when nothing is pending', async () => {
    const el = makeEl();
    document.body.append(el as unknown as Node); // connect → flush the first reinit synchronously
    expect(el.reinits).toBe(1);
    await el.whenSettled(); // already settled — resolves on a microtask
    expect(el.reinits).toBe(1);
  });

  it('resolves after the coalesced flush of loose property assignments', async () => {
    const el = makeEl();
    document.body.append(el as unknown as Node);
    el.reinits = 0;

    el.height = 42; // on:'reinit', staged on a microtask
    el.label = 'hi'; // on:'update', same tick → same flush
    expect(el.reinits).toBe(0); // not flushed yet — still this tick

    await el.whenSettled();
    expect(el.reinits).toBe(1); // one coalesced reinit (absorbs the update key)
    expect(el.updates).toHaveLength(0);
    expect(el.height).toBe(42);
  });

  it('is already settled right after setAttributes (synchronous flush)', async () => {
    const el = makeEl();
    document.body.append(el as unknown as Node);
    el.reinits = 0;

    el.setAttributes({ height: 7, label: 'x' });
    expect(el.reinits).toBe(1); // flushed synchronously

    // whenSettled resolves immediately; no further flush happens.
    await el.whenSettled();
    expect(el.reinits).toBe(1);
  });

  it('holds until connect when configured while detached', async () => {
    const el = makeEl();
    el.height = 99; // staged while detached — flush no-ops, stays pending

    let settled = false;
    void el.whenSettled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // still pending — not connected
    expect(el.reinits).toBe(0);

    document.body.append(el as unknown as Node); // first connect flushes with full config
    await el.whenSettled();
    expect(settled).toBe(true);
    expect(el.reinits).toBe(1); // ONE reinit, with height already applied
    expect(el.height).toBe(99);
  });
});
