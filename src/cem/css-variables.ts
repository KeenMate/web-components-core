/**
 * A CEM analyzer plugin that reads a KeenMate `component-variables.manifest.json`
 * and injects its variables into every custom-element declaration as
 * `cssProperties` (SPEC §12.4). The editor-integration generators
 * (`custom-element-vs-code-integration` / `custom-element-jet-brains-integration`)
 * read `cssProperties`, so this is what fills `vscode.css-custom-data.json` and
 * the CSS-variable contributions in `web-types.json` — giving consumers name +
 * description autocomplete for every theming variable inside `.css` files.
 *
 * The manifest is the single source of truth for the variable API (hundreds of
 * entries), so this beats hand-annotating each one as an `@cssproperty` JSDoc tag
 * (which would duplicate the manifest and drift). Build-time only — not imported
 * by the runtime bundle.
 */
// Build-time-only plugin. Core is a browser library and intentionally avoids a
// global `@types/node` dependency; the minimal Node built-in typings this file
// needs live in `./node-builtins.d.ts`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CemPlugin } from './plugin.js';

/** One row in a `component-variables.manifest.json` variable list. */
interface ManifestVariable {
  /** The variable name WITHOUT the leading `--` (e.g. `ms-badge-text-bg`). */
  name: string;
  category?: string;
  /** Human-readable description of what the variable controls. */
  usage?: string;
}

/** The relevant shape of `component-variables.manifest.json`. */
interface VariablesManifest {
  prefix?: string;
  /** Shared framework `--base-*` inputs (documented at the framework level). */
  baseVariables?: ManifestVariable[];
  /** The component's own `--<prefix>-*` API. */
  componentVariables?: ManifestVariable[];
}

/** A `cssProperties` entry as the editor-integration generators expect it. */
interface CssPropertyDoc {
  name: string;
  description?: string;
}

export interface CssVariablesPluginOptions {
  /**
   * Path to the variables manifest. A relative path resolves from the analyzer's
   * cwd — the component root where `cem analyze` runs. Default
   * `'component-variables.manifest.json'`.
   */
  manifestPath?: string;
  /**
   * Which variable sets to emit as `cssProperties`:
   * - `'component'` (default) — only the component's own `--<prefix>-*` API.
   * - `'base'` — only the shared framework `--base-*` inputs.
   * - `'both'` — component variables followed by base variables.
   */
  include?: 'component' | 'base' | 'both';
}

/** Minimal structural shape of a CEM declaration this plugin augments. */
interface CemDeclaration {
  customElement?: boolean;
  cssProperties?: CssPropertyDoc[];
  [key: string]: unknown;
}
interface CemModuleDoc {
  declarations?: CemDeclaration[];
  [key: string]: unknown;
}

/**
 * Create the plugin. Place it BEFORE the VS Code / JetBrains generators in your
 * analyzer config's `plugins` array so they see the injected `cssProperties`:
 *
 * ```js
 * plugins: [
 *   cssVariablesFromManifestPlugin(),
 *   customElementVsCodePlugin({ outdir: '.' }),
 *   customElementJetBrainsPlugin({ outdir: '.', packageJson: false }),
 * ]
 * ```
 *
 * Remember to add `vscode.css-custom-data.json` to your package's `files` array
 * and point `package.json`'s `customData` at it (`css.customData`) so VS Code
 * loads it.
 */
export function cssVariablesFromManifestPlugin(options: CssVariablesPluginOptions = {}): CemPlugin {
  const manifestPath = resolve(process.cwd(), options.manifestPath ?? 'component-variables.manifest.json');
  const include = options.include ?? 'component';

  // Read + map once, lazily; moduleLinkPhase runs once per module.
  let cssProperties: CssPropertyDoc[] | null = null;
  const load = (): CssPropertyDoc[] => {
    if (cssProperties) return cssProperties;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VariablesManifest;
    const rows: ManifestVariable[] = [];
    if (include !== 'base') rows.push(...(manifest.componentVariables ?? []));
    if (include !== 'component') rows.push(...(manifest.baseVariables ?? []));
    cssProperties = rows.map((v) => ({ name: `--${v.name}`, description: v.usage }));
    return cssProperties;
  };

  return {
    name: 'bliss-css-variables-from-manifest',
    moduleLinkPhase({ moduleDoc }: { moduleDoc: CemModuleDoc }) {
      const props = load();
      if (!props.length) return;
      for (const decl of moduleDoc.declarations ?? []) {
        // Manifest is the source of truth — replace, don't merge, so a variable
        // removed from the manifest can't linger from a prior declaration.
        if (decl.customElement) decl.cssProperties = props;
      }
    },
  };
}
