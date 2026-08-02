import { describe, it, expect } from 'vitest';
import { extractConsumedCssVars, declaredCssVars, suggestCssVars, lintCssVars } from './css-var-lint.js';

const P = '--ms-';

describe('extractConsumedCssVars', () => {
  it('finds every var(--prefix-…) read, ignoring whitespace and fallbacks', () => {
    const css = '.a{background:var(--ms-badge-text-bg);color:var( --ms-badge-text-color )} .b{width:var(--ms-dropdown-width,10rem)}';
    expect(extractConsumedCssVars(css, P)).toEqual(
      new Set(['--ms-badge-text-bg', '--ms-badge-text-color', '--ms-dropdown-width']),
    );
  });

  it('ignores plain declarations (only var() reads count)', () => {
    expect(extractConsumedCssVars('.a{--ms-badge-text-bg:red}', P)).toEqual(new Set());
  });

  it('respects the prefix (does not match other namespaces)', () => {
    expect(extractConsumedCssVars('.a{color:var(--drp-accent)}', P)).toEqual(new Set());
    expect(extractConsumedCssVars('.a{color:var(--drp-accent)}', '--drp-')).toEqual(new Set(['--drp-accent']));
  });
});

describe('declaredCssVars', () => {
  it('finds every --prefix-* declaration, de-duped', () => {
    const css = '.a{--ms-badge-text-bg:red;--ms-badge-text-color:#000} .b{--ms-badge-text-bg:blue}';
    expect(declaredCssVars(css, P).sort()).toEqual(['--ms-badge-text-bg', '--ms-badge-text-color']);
  });

  it('ignores custom properties outside the prefix', () => {
    expect(declaredCssVars('.a{--my-own:4px;color:red}', P)).toEqual([]);
  });
});

describe('suggestCssVars', () => {
  it('proposes the closest real variable for a typo', () => {
    const known = new Set(['--ms-badge-text-bg', '--ms-badge-text-color', '--ms-dropdown-width']);
    expect(suggestCssVars('--ms-badge-text-background', known)).toContain('--ms-badge-text-bg');
  });

  it('stays quiet when nothing shares ≥3 tokens (default)', () => {
    const known = new Set(['--ms-dropdown-width', '--ms-selected-popover-width']);
    expect(suggestCssVars('--ms-totally-unrelated-thing', known)).toEqual([]);
  });

  it('honours a custom minScore/limit', () => {
    const known = new Set(['--ms-dropdown-width', '--ms-dropdown-height']);
    expect(suggestCssVars('--ms-dropdown-x', known, { minScore: 2, limit: 1 })).toEqual(['--ms-dropdown-width']);
  });
});

describe('lintCssVars', () => {
  const consumed = new Set(['--ms-badge-text-bg', '--ms-badge-text-color']);

  it('flags declared vars that nothing consumes, with suggestions', () => {
    const findings = lintCssVars('.x{--ms-badge-text-background:red}', { prefix: P, consumed });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.name).toBe('--ms-badge-text-background');
    expect(findings[0]!.suggestions).toContain('--ms-badge-text-bg');
  });

  it('does not flag a var that IS consumed', () => {
    expect(lintCssVars('.x{--ms-badge-text-bg:red}', { prefix: P, consumed })).toEqual([]);
  });

  it('returns [] when there is no ground truth (empty consumed set)', () => {
    expect(lintCssVars('.x{--ms-anything:1px}', { prefix: P, consumed: new Set() })).toEqual([]);
  });
});
