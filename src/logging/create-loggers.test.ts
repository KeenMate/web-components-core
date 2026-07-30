import { afterEach, describe, expect, it, vi } from 'vitest';
import * as log from 'loglevel';
import { DEFAULT_CATEGORIES, createLoggers } from './create-loggers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLoggers', () => {
  it('builds one logger per default category, namespaced', () => {
    const { loggers, LOGGING_CATEGORIES } = createLoggers('NSDEFAULTS');
    expect(Object.keys(loggers)).toEqual([...DEFAULT_CATEGORIES]);
    expect(LOGGING_CATEGORIES).toEqual([...DEFAULT_CATEGORIES]);
    expect(log.getLogger('NSDEFAULTS:INIT')).toBe(loggers.INIT);
  });

  it('supports redefined and extended category lists', () => {
    const redefined = createLoggers('NSREDEF', ['INIT', 'DATA', 'INDEX', 'DRAG'] as const);
    expect(Object.keys(redefined.loggers)).toEqual(['INIT', 'DATA', 'INDEX', 'DRAG']);

    const extended = createLoggers('NSEXT', [...DEFAULT_CATEGORIES, 'FILE'] as const);
    expect(Object.keys(extended.loggers)).toEqual(['INIT', 'DATA', 'UI', 'FILE']);
    // typed access to the extra category
    expect(extended.loggers.FILE).toBeDefined();
  });

  it('prepends a colored %c label and leaves message args intact', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { loggers, enableLogging } = createLoggers('NSCOLOR');
    enableLogging();

    loggers.INIT.info('hello', { n: 1 });

    expect(spy).toHaveBeenCalledOnce();
    const args = spy.mock.calls[0]!;
    expect(args[0]).toBe('%c[NSCOLOR:INIT]');
    expect(String(args[1])).toContain('color:');
    expect(args[2]).toBe('hello');
    expect(args[3]).toEqual({ n: 1 });
  });

  it('enableLogging() defaults to debug; disableLogging() silences', () => {
    const bundle = createLoggers('NSLEVELS');
    bundle.enableLogging();
    expect(bundle.loggers.INIT.getLevel()).toBe(log.levels.DEBUG);
    bundle.disableLogging();
    expect(bundle.loggers.INIT.getLevel()).toBe(log.levels.SILENT);
  });

  it('setLogLevel sets all categories; setCategoryLevel sets one', () => {
    const bundle = createLoggers('NSSETLEVEL');
    bundle.setLogLevel('warn');
    expect(bundle.loggers.INIT.getLevel()).toBe(log.levels.WARN);
    expect(bundle.loggers.UI.getLevel()).toBe(log.levels.WARN);

    bundle.setCategoryLevel('UI', 'trace');
    expect(bundle.loggers.UI.getLevel()).toBe(log.levels.TRACE);
    expect(bundle.loggers.INIT.getLevel()).toBe(log.levels.WARN); // unchanged
  });

  it('does not double-wrap the prefix when called twice for the same name', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    createLoggers('NSIDEMP');
    const { loggers, enableLogging } = createLoggers('NSIDEMP'); // second call, same names
    enableLogging();

    loggers.INIT.info('msg');
    const args = spy.mock.calls[0]!;
    expect(args[0]).toBe('%c[NSIDEMP:INIT]'); // single prefix, not doubled
    expect(args[1]).toContain('color:');
  });
});
