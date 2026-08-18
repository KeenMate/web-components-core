import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { observeKeyboardInset } from './keyboard-inset.js';

/**
 * jsdom implements neither `window.visualViewport` nor a real rAF loop, so we
 * stub both: a minimal EventTarget-backed viewport we can drive by hand, and a
 * synchronous requestAnimationFrame so a scheduled write applies immediately.
 */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  resizeTo(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

describe('observeKeyboardInset', () => {
  let vp: FakeViewport;

  beforeEach(() => {
    vp = new FakeViewport();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    // jsdom's window.visualViewport is undefined; define it for the test.
    Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  it('pins the panel to the visual viewport height + offset on attach', () => {
    const panel = document.createElement('div');
    observeKeyboardInset(panel);
    expect(panel.style.height).toBe('800px');
    expect(panel.style.top).toBe('0px');
  });

  it('shrinks the panel as the keyboard opens (viewport resize)', () => {
    const panel = document.createElement('div');
    observeKeyboardInset(panel);
    vp.resizeTo(500, 40); // keyboard opens: shorter viewport, scrolled down
    expect(panel.style.height).toBe('500px');
    expect(panel.style.top).toBe('40px');
  });

  it('cleanup detaches listeners and clears the inline geometry', () => {
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    cleanup();
    expect(panel.style.height).toBe('');
    expect(panel.style.top).toBe('');
    vp.resizeTo(300); // must be ignored after cleanup
    expect(panel.style.height).toBe('');
  });

  it('is a no-op returning a no-op cleanup when visualViewport is unavailable', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    const panel = document.createElement('div');
    const cleanup = observeKeyboardInset(panel);
    expect(panel.style.height).toBe('');
    expect(() => cleanup()).not.toThrow();
  });
});
