import { describe, it, expect, afterEach } from 'vitest';
import { lockBodyScroll, __resetScrollLock } from './scroll-lock.js';

describe('lockBodyScroll', () => {
  afterEach(() => {
    __resetScrollLock();
    document.body.style.overflow = '';
  });

  it('sets body overflow hidden and restores the prior value on release', () => {
    document.body.style.overflow = 'auto';
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('restores an initially-empty overflow', () => {
    document.body.style.overflow = '';
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    release();
    expect(document.body.style.overflow).toBe('');
  });

  it('ref-counts: stays locked until the last release', () => {
    document.body.style.overflow = 'scroll';
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    a();
    expect(document.body.style.overflow).toBe('hidden'); // b still holds
    b();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('release is idempotent — a double-release cannot unbalance the count', () => {
    document.body.style.overflow = 'auto';
    const a = lockBodyScroll();
    const b = lockBodyScroll();
    a();
    a(); // second call is a no-op, must NOT drop b's hold
    expect(document.body.style.overflow).toBe('hidden');
    b();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('captures the value present at the FIRST lock, not at a nested one', () => {
    document.body.style.overflow = 'auto';
    const a = lockBodyScroll();
    document.body.style.overflow = 'hidden'; // some other write while locked
    const b = lockBodyScroll();
    a();
    b();
    expect(document.body.style.overflow).toBe('auto');
  });
});
