// Minimal Node built-in typings for the build-time-only CEM plugins (SPEC §12.4),
// so core can avoid a global `@types/node` dependency — which would leak Node
// globals (e.g. `NodeJS.Timeout` for `setTimeout`, `Buffer`) across the whole
// browser library's typecheck. This is a pure ambient declaration file (no
// imports/exports), so `declare module 'node:*'` reads as a standalone ambient
// module declaration rather than an augmentation of a missing module.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string;
}

declare var process: { cwd(): string };
