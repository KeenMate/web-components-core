/**
 * A `@custom-elements-manifest/analyzer` plugin that teaches the analyzer to
 * read BlissElement's `static inputs` / `static events` tables (SPEC §12.4).
 * Without it the analyzer sees nothing — our public surface lives in tables, not
 * in the Lit-style patterns it recognizes. This wrapper is deliberately thin:
 * all extraction logic lives in {@link ./extract} (pure, unit-tested). It runs
 * per class node in `analyzePhase`, then merges the results into the manifest's
 * class declaration in `moduleLinkPhase`, so it augments (never replaces) the
 * analyzer's own class analysis.
 *
 * The analyzer injects the `typescript` API, so this module has NO runtime
 * dependency on it — the types below are structural and intentionally loose to
 * avoid a hard dependency on the analyzer's internal types.
 */
import { extractBlissClass, type ExtractedClass } from './extract.js';

/** Minimal shape of a CEM class-like declaration this plugin augments. */
interface CemDeclaration {
  kind?: string;
  name?: string;
  attributes?: unknown[];
  members?: unknown[];
  events?: unknown[];
  [key: string]: unknown;
}

interface CemModuleDoc {
  path?: string;
  declarations?: CemDeclaration[];
  [key: string]: unknown;
}

/** The analyzer's plugin interface (only the hooks this plugin uses). */
export interface CemPlugin {
  name: string;
  analyzePhase?(params: { ts: unknown; node: unknown; moduleDoc: CemModuleDoc; context: unknown }): void;
  moduleLinkPhase?(params: { moduleDoc: CemModuleDoc; context: unknown }): void;
}

/** Merge an attribute/member/event by `name`, extracted data winning on conflicts. */
function mergeByName<T extends { name?: string }>(existing: unknown[] | undefined, incoming: T[]): T[] {
  const out = [...((existing ?? []) as T[])];
  for (const item of incoming) {
    const at = out.findIndex((e) => e && e.name === item.name);
    if (at >= 0) out[at] = { ...out[at], ...item };
    else out.push(item);
  }
  return out;
}

/**
 * Create the plugin. Pass it in your analyzer config's `plugins` array — or use
 * {@link ./config.blissAnalyzerConfig} which includes it.
 */
export function blissInputsPlugin(): CemPlugin {
  // className → extracted data, filled in analyzePhase, consumed in moduleLinkPhase.
  const extracted = new Map<string, ExtractedClass>();

  return {
    name: 'keenmate-bliss-inputs',

    analyzePhase({ ts, node }) {
      const tsApi = ts as typeof import('typescript');
      const n = node as import('typescript').Node;
      if (!tsApi.isClassDeclaration(n)) return;
      const meta = extractBlissClass(tsApi, n, n.getSourceFile());
      if (meta) extracted.set(meta.name, meta);
    },

    moduleLinkPhase({ moduleDoc }) {
      for (const decl of moduleDoc.declarations ?? []) {
        if (!decl.name) continue;
        const meta = extracted.get(decl.name);
        if (!meta) continue;
        if (meta.attributes.length) decl.attributes = mergeByName(decl.attributes, meta.attributes);
        if (meta.members.length) decl.members = mergeByName(decl.members, meta.members);
        if (meta.events.length) decl.events = mergeByName(decl.events, meta.events);
      }
    },
  };
}
