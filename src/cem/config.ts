/**
 * Shared `custom-elements-manifest` analyzer config preset (SPEC §12.4). Every
 * KeenMate component's `custom-elements-manifest.config.js` extends this so the
 * globs, excludes, and — crucially — the {@link blissInputsPlugin} are declared
 * once instead of copy-pasted five ways.
 *
 * ```js
 * // custom-elements-manifest.config.js
 * import { blissAnalyzerConfig } from '@keenmate/web-components-core/cem';
 * export default blissAnalyzerConfig();
 * ```
 */
import { blissInputsPlugin, type CemPlugin } from './plugin.js';

/** The subset of the analyzer config this preset sets (loosely typed — the analyzer accepts more). */
export interface BlissAnalyzerConfig {
  globs: string[];
  exclude: string[];
  outdir: string;
  plugins: CemPlugin[];
  [key: string]: unknown;
}

/** Options for {@link blissAnalyzerConfig}; each overrides the preset default. */
export interface BlissAnalyzerOptions {
  /** Source globs to analyze. Default: `['src/**\/*.ts']`. */
  globs?: string[];
  /** Globs to skip. Default: tests, declarations, and the barrel. */
  exclude?: string[];
  /** Output directory for `custom-elements.json`. Default: `'.'`. */
  outdir?: string;
  /** Extra plugins to run AFTER {@link blissInputsPlugin}. */
  plugins?: CemPlugin[];
  /** Any other analyzer config keys, merged verbatim. */
  extra?: Record<string, unknown>;
}

/**
 * Build an analyzer config with the Bliss inputs plugin wired in. The plugin
 * runs first so downstream plugins see the table-derived attributes/members/
 * events already on each declaration.
 */
export function blissAnalyzerConfig(options: BlissAnalyzerOptions = {}): BlissAnalyzerConfig {
  return {
    globs: options.globs ?? ['src/**/*.ts'],
    exclude: options.exclude ?? ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
    outdir: options.outdir ?? '.',
    plugins: [blissInputsPlugin(), ...(options.plugins ?? [])],
    ...(options.extra ?? {}),
  };
}
