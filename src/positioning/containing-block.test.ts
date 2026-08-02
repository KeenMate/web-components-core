import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFixedPositionOffsetParent,
  findContainingBlockCulprit,
  detectFixedDrift,
} from './containing-block.js';

/**
 * jsdom has no layout, so `getComputedStyle`/`getBoundingClientRect` are stubbed
 * to feed the helpers controlled values. This covers the geometry (drift math,
 * viewport-space translation, culprit matching) — the real-browser behaviour is
 * covered by the consumers' e2e (e.g. web-multiselect's positioning specs).
 */

function stubStyles(map: Map<Element, Partial<CSSStyleDeclaration>>) {
  return vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (el: Element) =>
      ({
        transform: 'none',
        perspective: 'none',
        filter: 'none',
        willChange: '',
        contain: '',
        borderLeftWidth: '0px',
        borderTopWidth: '0px',
        ...(map.get(el) ?? {}),
      }) as CSSStyleDeclaration,
  );
}

function stubRect(el: Element, x: number, y: number, width = 0, height = 0) {
  el.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('getFixedPositionOffsetParent', () => {
  it('returns window when no ancestor establishes a fixed containing block', () => {
    stubStyles(new Map());
    const outer = document.createElement('div');
    const el = document.createElement('span');
    outer.append(el);
    document.body.append(outer);
    expect(getFixedPositionOffsetParent(el)).toBe(window);
  });

  it('returns the ancestor that has a transform', () => {
    const outer = document.createElement('div');
    const el = document.createElement('span');
    outer.append(el);
    document.body.append(outer);
    stubStyles(new Map([[outer, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }]]));
    expect(getFixedPositionOffsetParent(el)).toBe(outer);
  });

  it('ignores contain / container-type (browsers do not honour them for fixed)', () => {
    const outer = document.createElement('div');
    const el = document.createElement('span');
    outer.append(el);
    document.body.append(outer);
    stubStyles(new Map([[outer, { contain: 'layout paint', containerType: 'inline-size' } as Partial<CSSStyleDeclaration>]]));
    expect(getFixedPositionOffsetParent(el)).toBe(window);
  });
});

describe('detectFixedDrift', () => {
  it('returns null when the panel lands within tolerance (viewport-anchored)', () => {
    stubStyles(new Map());
    const panel = document.createElement('div');
    const reference = document.createElement('button');
    document.body.append(panel, reference);
    stubRect(panel, 10, 20);
    expect(
      detectFixedDrift({ panel, reference, expectedX: 10, expectedY: 20, offsetParent: window }),
    ).toBeNull();
  });

  it('does NOT flag drift when an offset parent legitimately anchors the panel', () => {
    // Regression: coords are relative to the offset parent's padding box, not the
    // viewport. Panel at viewport (110,20); offset parent at (100,0); expected
    // (10,20) relative to it -> 100+10, 0+20 -> no drift.
    stubStyles(new Map());
    const cb = document.createElement('div');
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    cb.append(reference);
    document.body.append(cb, panel);
    stubRect(cb, 100, 0);
    stubRect(panel, 110, 20);
    expect(
      detectFixedDrift({ panel, reference, expectedX: 10, expectedY: 20, offsetParent: cb }),
    ).toBeNull();
  });

  it('reports drift and names the culprit ancestor', () => {
    const culprit = document.createElement('div');
    culprit.id = 'app';
    culprit.className = 'layout main extra';
    const reference = document.createElement('button');
    const panel = document.createElement('div');
    culprit.append(reference);
    document.body.append(culprit, panel);

    stubStyles(new Map([[culprit, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }]]));
    stubRect(culprit, 100, 0); // its rect matches the drift below
    stubRect(panel, 110, 20); // we expected viewport (10,20) but it rendered (110,20)

    const report = detectFixedDrift({ panel, reference, expectedX: 10, expectedY: 20, offsetParent: window });
    expect(report).not.toBeNull();
    expect(report!.driftX).toBe(100);
    expect(report!.driftY).toBe(0);
    expect(report!.culprit).toBe(culprit);
    expect(report!.culpritDescription).toBe('<div#app.layout.main>'); // up to two classes
    expect(report!.culpritCss).toContain('transform:');
  });
});

describe('findContainingBlockCulprit', () => {
  it('finds the ancestor whose rect matches the drift', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const ref = document.createElement('button');
    a.append(b);
    b.append(ref);
    document.body.append(a);
    stubRect(a, 999, 999);
    stubRect(b, 50, 60);
    expect(findContainingBlockCulprit(ref, 50, 60)).toBe(b);
  });

  it('returns null when nothing matches', () => {
    const a = document.createElement('div');
    const ref = document.createElement('button');
    a.append(ref);
    document.body.append(a);
    stubRect(a, 999, 999);
    expect(findContainingBlockCulprit(ref, 5, 5)).toBeNull();
  });
});
