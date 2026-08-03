import { describe, expect, it, vi } from 'vitest';

// Mock the manifest read so the plugin needs no file on disk.
vi.mock('node:fs', () => {
  const readFileSync = () =>
    JSON.stringify({
      prefix: 'ms',
      componentVariables: [
        { name: 'ms-badge-text-bg', category: 'badge', usage: 'Badge text background' },
        { name: 'ms-gap', usage: 'Gap between items' },
      ],
      baseVariables: [{ name: 'base-input-height', usage: 'Base input height' }],
    });
  return { readFileSync, default: { readFileSync } };
});

import { cssVariablesFromManifestPlugin } from './css-variables.js';

interface Decl {
  customElement: boolean;
  name?: string;
  cssProperties?: Array<{ name: string; description?: string }>;
}
const run = (plugin: ReturnType<typeof cssVariablesFromManifestPlugin>, declarations: Decl[]) =>
  plugin.moduleLinkPhase?.({ moduleDoc: { declarations }, context: undefined } as never);

describe('cssVariablesFromManifestPlugin', () => {
  it('injects componentVariables as cssProperties on custom-element declarations only', () => {
    const decls: Decl[] = [
      { customElement: true, name: 'X' },
      { customElement: false, name: 'Helper' },
    ];
    run(cssVariablesFromManifestPlugin(), decls);

    expect(decls[0]!.cssProperties).toEqual([
      { name: '--ms-badge-text-bg', description: 'Badge text background' },
      { name: '--ms-gap', description: 'Gap between items' },
    ]);
    // A non-custom-element declaration is left untouched.
    expect(decls[1]!.cssProperties).toBeUndefined();
  });

  it("include:'both' appends base variables after component variables", () => {
    const decls: Decl[] = [{ customElement: true }];
    run(cssVariablesFromManifestPlugin({ include: 'both' }), decls);
    expect(decls[0]!.cssProperties?.map((p) => p.name)).toEqual([
      '--ms-badge-text-bg',
      '--ms-gap',
      '--base-input-height',
    ]);
  });

  it("include:'base' emits only base variables", () => {
    const decls: Decl[] = [{ customElement: true }];
    run(cssVariablesFromManifestPlugin({ include: 'base' }), decls);
    expect(decls[0]!.cssProperties?.map((p) => p.name)).toEqual(['--base-input-height']);
  });

  it('replaces (does not merge) any prior cssProperties so removed vars cannot linger', () => {
    const decls: Decl[] = [{ customElement: true, cssProperties: [{ name: '--ms-stale' }] }];
    run(cssVariablesFromManifestPlugin(), decls);
    expect(decls[0]!.cssProperties?.map((p) => p.name)).toEqual(['--ms-badge-text-bg', '--ms-gap']);
  });
});
