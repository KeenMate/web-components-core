import { describe, expect, it } from 'vitest';
import { resolveEnumAttribute } from './resolve-enum-attribute.js';
import { createMicrotaskScheduler } from './microtask-scheduler.js';

describe('resolveEnumAttribute', () => {
  const MODES = ['top', 'bottom'] as const;

  it('matches against the set with a fallback', () => {
    expect(resolveEnumAttribute('top', MODES, 'bottom')).toBe('top');
    expect(resolveEnumAttribute('nope', MODES, 'bottom')).toBe('bottom');
    expect(resolveEnumAttribute(null, MODES, 'bottom')).toBe('bottom');
  });

  it('supports case-insensitive matching', () => {
    expect(resolveEnumAttribute('TOP', MODES, 'bottom', { caseInsensitive: true })).toBe('top');
    expect(resolveEnumAttribute('TOP', MODES, 'bottom')).toBe('bottom');
  });
});

describe('createMicrotaskScheduler', () => {
  it('coalesces repeated scheduling of the same task into one run', async () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    const task = (): void => {
      runs += 1;
    };
    scheduler.schedule(task);
    scheduler.schedule(task);
    scheduler.schedule(task);
    expect(runs).toBe(0);
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(runs).toBe(1);
  });

  it('runs pending work synchronously on flush', () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    scheduler.schedule(() => {
      runs += 1;
    });
    scheduler.flush();
    expect(runs).toBe(1);
  });

  it('discards pending work on cancel', async () => {
    const scheduler = createMicrotaskScheduler();
    let runs = 0;
    scheduler.schedule(() => {
      runs += 1;
    });
    scheduler.cancel();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(runs).toBe(0);
  });
});
