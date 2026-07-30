import { describe, expect, it } from 'vitest';
import { toBool, toBytes, toCustom, toEnum, toFloat, toFunction, toInt, toList, toObject, toObjectArray, toText, toValue } from './converters.js';

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

  it('exposes its values and supports shouldNullOnInvalid', () => {
    const c = toEnum(SELECTION, { shouldNullOnInvalid: true });
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

  it('range-checks the max bound', () => {
    const c = toInt({ max: 100, default: 0 });
    expect(c.fromAttribute!('100', reader(), 'x')).toBe(100);
    expect(c.fromAttribute!('101', reader(), 'x')).toBe(0);
    expect(c.validate!(101)).toBe(false);
  });
});

describe('toText', () => {
  it('trims, guards empties, and falls back', () => {
    const c = toText({ shouldTrim: true, default: 'Search...' });
    expect(c.fromAttribute!('  hi ', reader(), 'x')).toBe('hi');
    expect(c.fromAttribute!('   ', reader(), 'x')).toBe('Search...');
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('Search...');
    expect(c.validate!('')).toBe(false);
    expect(c.validate!('ok')).toBe(true);
  });

  it('allows empty strings when told to', () => {
    const c = toText({ isEmptyAllowed: true });
    expect(c.fromAttribute!('', reader(), 'x')).toBe('');
    expect(c.validate!('')).toBe(true);
  });

  it('isNullable: absent/empty → null, distinguishing unset from empty', () => {
    const c = toText({ isNullable: true, shouldTrim: true });
    expect(c.fromAttribute!(null, reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('', reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('   ', reader(), 'x')).toBeNull();
    expect(c.fromAttribute!('hi', reader(), 'x')).toBe('hi');
    // property path: null clears, '' still rejected, real strings pass
    expect(c.validate!(null)).toBe(true);
    expect(c.validate!('')).toBe(false);
    expect(c.validate!('ok')).toBe(true);
    // reflection removes the attribute for the null sentinel
    expect(c.toAttribute!(null)).toBeNull();
    expect(c.toAttribute!('ok')).toBe('ok');
  });

  it('non-nullable still rejects null and seeds ""', () => {
    const c = toText();
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('');
    expect(c.validate!(null)).toBe(false);
  });

  it('isNullable honours an explicit default', () => {
    const c = toText({ isNullable: true, default: 'fallback' });
    expect(c.fromAttribute!(null, reader(), 'x')).toBe('fallback');
    expect(c.fromAttribute!('', reader(), 'x')).toBe('fallback');
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

  it('parses fractional sizes', () => {
    const c = toBytes({ default: 0 });
    expect(c.fromAttribute!('1.5kb', reader(), 'x')).toBe(1536);
  });
});

describe('toList', () => {
  it('parses pipe-delimited fixed-count string lists', () => {
    const c = toList({ itemType: 'string', separator: '|', requiredCount: 3 });
    expect(c.fromAttribute!('a|b|c', reader(), 'x')).toEqual(['a', 'b', 'c']);
    expect(c.fromAttribute!('a|b', reader(), 'x')).toEqual([]); // count mismatch → default
    expect(c.validate!(['a', 'b', 'c'])).toBe(true);
    expect(c.validate!(['a', 'b'])).toBe(false);
  });

  it('parses int lists and rejects NaN items', () => {
    const c = toList({ itemType: 'int' });
    expect(c.fromAttribute!('1,2,3', reader(), 'x')).toEqual([1, 2, 3]);
    expect(c.fromAttribute!('1,x,3', reader(), 'x')).toEqual([]);
    expect(c.validate!([1, 2])).toBe(true);
    expect(c.validate!([1, '2'])).toBe(false);
  });

  it('empty or absent → default', () => {
    const c = toList({ default: ['x'] });
    expect(c.fromAttribute!('', reader(), 'x')).toEqual(['x']);
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual(['x']);
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

describe('toValue', () => {
  it('property path accepts anything without a validate', () => {
    const c = toValue();
    expect(c.validate).toBeUndefined();
  });

  it('property path enforces a supplied validate', () => {
    const c = toValue<number>({ validate: (v): v is number => typeof v === 'number' });
    expect(c.validate!(3)).toBe(true);
    expect(c.validate!('x')).toBe(false);
  });

  it('attribute path parses JSON, falling back on blank/malformed/invalid', () => {
    const c = toValue<{ a: number }>({ default: { a: 0 }, validate: (v): v is { a: number } => typeof v === 'object' && v !== null && 'a' in v });
    expect(c.fromAttribute!('{"a":5}', reader(), 'x')).toEqual({ a: 5 });
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual({ a: 0 }); // absent → default
    expect(c.fromAttribute!('  ', reader(), 'x')).toEqual({ a: 0 }); // blank → default
    expect(c.fromAttribute!('{bad', reader(), 'x')).toEqual({ a: 0 }); // malformed → default
    expect(c.fromAttribute!('42', reader(), 'x')).toEqual({ a: 0 }); // fails validate → default
  });

  it('reflects as JSON', () => {
    const c = toValue();
    expect(c.toAttribute!({ a: 1 })).toBe('{"a":1}');
    expect(c.toAttribute!(null as never)).toBeNull();
  });
});

describe('toObjectArray', () => {
  it('property path requires an array; default is []', () => {
    const c = toObjectArray();
    expect(c.fromAttribute!(null, reader(), 'x')).toEqual([]);
    expect(c.validate!([{ id: 1 }])).toBe(true);
    expect(c.validate!('nope')).toBe(false);
    expect(c.validate!({ length: 0 })).toBe(false);
  });

  it('honors a per-item guard on both paths', () => {
    const c = toObjectArray<number>({ validateItem: (i): i is number => typeof i === 'number', default: [] });
    expect(c.fromAttribute!('[1,2,3]', reader(), 'x')).toEqual([1, 2, 3]);
    expect(c.fromAttribute!('[1,"x"]', reader(), 'x')).toEqual([]); // bad item → default
    expect(c.validate!([1, 2])).toBe(true);
    expect(c.validate!([1, 'x'])).toBe(false);
  });

  it('parses JSON on the attribute path and reflects as JSON', () => {
    const c = toObjectArray();
    expect(c.fromAttribute!('[{"id":1}]', reader(), 'x')).toEqual([{ id: 1 }]);
    expect(c.fromAttribute!('{bad', reader(), 'x')).toEqual([]);
    expect(c.toAttribute!([{ id: 1 }])).toBe('[{"id":1}]');
  });
});

describe('toObject', () => {
  it('requires a non-null, non-array object', () => {
    const c = toObject();
    expect(c.validate!({ a: 1 })).toBe(true);
    expect(c.validate!(null)).toBe(false);
    expect(c.validate!([1, 2])).toBe(false); // arrays rejected
    expect(c.validate!('x')).toBe(false);
  });

  it('attribute path parses JSON objects, else default (undefined by default)', () => {
    const c = toObject();
    expect(c.fromAttribute!('{"a":1}', reader(), 'x')).toEqual({ a: 1 });
    expect(c.fromAttribute!('[1]', reader(), 'x')).toBeUndefined(); // array → default
    expect(c.fromAttribute!(null, reader(), 'x')).toBeUndefined();
  });

  it('uses a supplied default and reflects as JSON', () => {
    const c = toObject({ default: { theme: 'light' } });
    expect(c.fromAttribute!('bad', reader(), 'x')).toEqual({ theme: 'light' });
    expect(c.toAttribute!({ theme: 'dark' })).toBe('{"theme":"dark"}');
  });
});

function reader(attrs: Record<string, string> = {}) {
  return {
    getAttribute: (n: string) => (n in attrs ? attrs[n]! : null),
    hasAttribute: (n: string) => n in attrs,
  };
}
