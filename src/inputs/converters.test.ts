import { describe, expect, it } from 'vitest';
import { toBool, toBytes, toCustom, toEnum, toFloat, toFunction, toInt, toList, toText } from './converters.js';

describe('toEnum', () => {
  const SELECTION = ['single', 'multiple', 'range'] as const;

  it('parses an exact match and falls back on invalid/absent', () => {
    const c = toEnum(SELECTION, { default: 'single' });
    expect(c.fromAttribute!('range', reader(), 'x')).toBe('range');
    expect(c.fromAttribute!('nope', reader(), 'x')).toBe('single');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('single');
  });

  it('validates property assignments against the same set', () => {
    const c = toEnum(SELECTION, { default: 'single' });
    expect(c.validate!('multiple')).toBe(true);
    expect(c.validate!('bogus')).toBe(false);
    expect(c.validate!(3)).toBe(false);
  });

  it('exposes its values and supports nullOnInvalid', () => {
    const c = toEnum(SELECTION, { nullOnInvalid: true });
    expect(c.values).toEqual(SELECTION);
    expect(c.fromAttribute!('nope', reader(), 'x')).toBeNull();
  });
});

describe('toInt / toFloat', () => {
  it('range-checks and falls back', () => {
    const c = toInt({ min: 1, default: 50 });
    expect(c.fromAttribute!('10', reader(), 'x')).toBe(10);
    expect(c.fromAttribute!('0', reader(), 'x')).toBe(50);
    expect(c.fromAttribute!('abc', reader(), 'x')).toBe(50);
    expect(c.validate!(10)).toBe(true);
    expect(c.validate!(0)).toBe(false);
    expect(c.validate!(1.5)).toBe(false);
  });

  it('parses floats without integer constraint', () => {
    const c = toFloat({ min: 0, max: 1, default: 0.5 });
    expect(c.fromAttribute!('0.25', reader(), 'x')).toBe(0.25);
    expect(c.fromAttribute!('2', reader(), 'x')).toBe(0.5);
    expect(c.validate!(0.9)).toBe(true);
  });
});

describe('toText', () => {
  it('trims, guards empties, and falls back', () => {
    const c = toText({ trim: true, default: 'Search...' });
    expect(c.fromAttribute!('  hi ', reader(), 'x')).toBe('hi');
    expect(c.fromAttribute!('   ', reader(), 'x')).toBe('Search...');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('Search...');
    expect(c.validate!('')).toBe(false);
    expect(c.validate!('ok')).toBe(true);
  });

  it('allows empty strings when told to', () => {
    const c = toText({ allowEmpty: true });
    expect(c.fromAttribute!('', reader(), 'x')).toBe('');
    expect(c.validate!('')).toBe(true);
  });
});

describe('toBool', () => {
  it('presence mode', () => {
    const c = toBool('presence');
    expect(c.fromAttribute!('', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('anything', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!(null, reader(), 'x')).toBe(false);
    expect(c.toAttribute!(true)).toBe('');
    expect(c.toAttribute!(false)).toBeNull();
  });

  it('default-true mode', () => {
    const c = toBool('default-true');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('false', reader(), 'x')).toBe(false);
    expect(c.fromAttribute!('true', reader(), 'x')).toBe(true);
  });

  it('tristate mode', () => {
    const c = toBool('tristate');
    expect(c.fromAttribute!(null, reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('true', reader(), 'x')).toBe(true);
    expect(c.fromAttribute!('false', reader(), 'x')).toBe(false);
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!(true)).toBe(true);
  });
});

describe('toBytes', () => {
  it('parses human sizes', () => {
    const c = toBytes({ default: 0 });
    expect(c.fromAttribute!('10mb', reader(), 'x')).toBe(10485760);
    expect(c.fromAttribute!('1kb', reader(), 'x')).toBe(1024);
    expect(c.fromAttribute!('512', reader(), 'x')).toBe(512);
    expect(c.fromAttribute!('nonsense', reader(), 'x')).toBe(0);
  });
});

describe('toList', () => {
  it('parses pipe-delimited fixed-count string lists', () => {
    const c = toList({ of: 'string', sep: '|', count: 3 });
    expect(c.fromAttribute!('a|b|c', reader(), 'x')).toEqual(['a', 'b', 'c']);
    expect(c.fromAttribute!('a|b', reader(), 'x')).toEqual([]); // count mismatch → default
    expect(c.validate!(['a', 'b', 'c'])).toBe(true);
    expect(c.validate!(['a', 'b'])).toBe(false);
  });

  it('parses int lists and rejects NaN items', () => {
    const c = toList({ of: 'int' });
    expect(c.fromAttribute!('1,2,3', reader(), 'x')).toEqual([1, 2, 3]);
    expect(c.fromAttribute!('1,x,3', reader(), 'x')).toEqual([]);
    expect(c.validate!([1, 2])).toBe(true);
    expect(c.validate!([1, '2'])).toBe(false);
  });
});

describe('toCustom', () => {
  it('wraps a bespoke parser with optional validate', () => {
    const parseWeekStart = (raw: string | null): 'auto' | number =>
      raw === 'auto' || raw === null ? 'auto' : Number.parseInt(raw, 10);
    const c = toCustom(parseWeekStart, {
      validate: (v): v is 'auto' | number => v === 'auto' || (typeof v === 'number' && v >= 0 && v <= 6),
    });
    expect(c.fromAttribute!('auto', reader(), 'x')).toBe('auto');
    expect(c.fromAttribute!('3', reader(), 'x')).toBe(3);
    expect(c.validate!(6)).toBe(true);
    expect(c.validate!(9)).toBe(false);
  });
});

describe('toFunction', () => {
  it('is property-only and validates callables', () => {
    const c = toFunction();
    expect(c.fromAttribute).toBeUndefined();
    expect(c.validate!(() => {})).toBe(true);
    expect(c.validate!(42)).toBe(false);
  });
});

function reader(attrs: Record<string, string> = {}) {
  return {
    getAttribute: (n: string) => (n in attrs ? attrs[n]! : null),
    hasAttribute: (n: string) => n in attrs,
  };
}
