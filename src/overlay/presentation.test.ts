import { describe, it, expect } from 'vitest';
import type { EnvironmentSnapshot } from '../environment/environment.js';
import { resolveMobilePresentation, TABLET_MIN_SHORT_SIDE } from './presentation.js';

/**
 * The `mobile-presentation` resolver maps the author setting + the live
 * device/viewport environment to a floating/fullscreen mode. The key subtlety it
 * guards: `auto` keys off `isTouchPrimary` AND the *shorter* viewport dimension
 * (the Material `sw600dp` line), so a landscape phone (wide, but short side ~390)
 * still gets the overlay while a tablet keeps floating.
 */

/** Build an EnvironmentSnapshot, defaulting to a desktop and overriding per test. */
function env(over: Partial<EnvironmentSnapshot>): EnvironmentSnapshot {
  return {
    pointer: 'fine',
    hasCoarsePointer: false,
    canHover: true,
    isTouchPrimary: false,
    orientation: 'landscape',
    viewportWidth: 1440,
    viewportHeight: 900,
    breakpoint: 'desktop',
    os: 'unknown',
    isApple: false,
    isAndroid: false,
    ...over,
  };
}

// The 2026 CSS-width phone band (physical ÷ DPR): compact ~320–360, mainstream
// ~390–393, large/Pro-Max up to ~430–480. Folds *open* jump to ~700+ (tablet).
const compactPhone = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 360, viewportHeight: 780 });
const phonePortrait = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 390, viewportHeight: 844 });
const phoneLandscape = env({ isTouchPrimary: true, orientation: 'landscape', viewportWidth: 844, viewportHeight: 390 });
const proMaxLandscape = env({ isTouchPrimary: true, orientation: 'landscape', viewportWidth: 932, viewportHeight: 430 });
const largePhonePortrait = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 480, viewportHeight: 1040 });
const foldOpen = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 720, viewportHeight: 960 });
const tablet = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 768, viewportHeight: 1024 });
const sevenInchTablet = env({ isTouchPrimary: true, orientation: 'portrait', viewportWidth: 600, viewportHeight: 960 });
const desktop = env({});

describe('resolveMobilePresentation', () => {
  describe("mode 'auto'", () => {
    it('→ fullscreen across the whole phone band: compact 360, mainstream 390, large 480', () => {
      expect(resolveMobilePresentation('auto', compactPhone)).toBe('fullscreen');
      expect(resolveMobilePresentation('auto', phonePortrait)).toBe('fullscreen');
      expect(resolveMobilePresentation('auto', largePhonePortrait)).toBe('fullscreen');
    });

    it('→ fullscreen on a LANDSCAPE phone (short side still phone-sized, width lies)', () => {
      expect(resolveMobilePresentation('auto', phoneLandscape)).toBe('fullscreen');
      expect(resolveMobilePresentation('auto', proMaxLandscape)).toBe('fullscreen');
    });

    it('→ floating on a tablet (touch-primary, but short side ≥ 600)', () => {
      expect(resolveMobilePresentation('auto', tablet)).toBe('floating');
    });

    it('→ floating on a 7" tablet at exactly the boundary (600 is a tablet)', () => {
      expect(resolveMobilePresentation('auto', sevenInchTablet)).toBe('floating');
    });

    it('→ floating on an opened foldable (jumps to tablet width ~700+)', () => {
      expect(resolveMobilePresentation('auto', foldOpen)).toBe('floating');
    });

    it('→ floating on desktop (not touch-primary)', () => {
      expect(resolveMobilePresentation('auto', desktop)).toBe('floating');
    });

    it('respects the short-side boundary exactly (< 600 is a phone)', () => {
      const justUnder = env({ isTouchPrimary: true, viewportWidth: 900, viewportHeight: TABLET_MIN_SHORT_SIDE - 1 });
      const atBoundary = env({ isTouchPrimary: true, viewportWidth: 900, viewportHeight: TABLET_MIN_SHORT_SIDE });
      expect(resolveMobilePresentation('auto', justUnder)).toBe('fullscreen');
      expect(resolveMobilePresentation('auto', atBoundary)).toBe('floating');
    });
  });

  describe("mode 'floating'", () => {
    it('always floats, even on a phone', () => {
      expect(resolveMobilePresentation('floating', phonePortrait)).toBe('floating');
      expect(resolveMobilePresentation('floating', desktop)).toBe('floating');
    });
  });

  describe("mode 'fullscreen'", () => {
    it('forces the overlay on ANY device, including desktop (preview/testing)', () => {
      expect(resolveMobilePresentation('fullscreen', phonePortrait)).toBe('fullscreen');
      expect(resolveMobilePresentation('fullscreen', tablet)).toBe('fullscreen');
      expect(resolveMobilePresentation('fullscreen', desktop)).toBe('fullscreen');
    });
  });
});
