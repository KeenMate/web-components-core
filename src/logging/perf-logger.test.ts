import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPerfLogger } from './perf-logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPerfLogger', () => {
  it('times a span and returns elapsed ms', () => {
    const perf = createPerfLogger('PERFA');
    perf.start('load');
    const ms = perf.end('load');
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('measure() records the span and returns the wrapped result', () => {
    const perf = createPerfLogger('PERFB');
    expect(perf.measure('calc', () => 21 * 2)).toBe(42);
  });

  it('warns and returns 0 when end() has no matching start()', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const perf = createPerfLogger('PERFC');
    expect(perf.end('missing')).toBe(0);
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]![0])).toContain('%c[PERFC:PERF]');
  });

  it('summary() and clear() do not throw', () => {
    const perf = createPerfLogger('PERFD');
    perf.measure('a', () => 1);
    expect(() => perf.summary()).not.toThrow();
    perf.clear();
    expect(() => perf.summary()).not.toThrow();
  });
});
