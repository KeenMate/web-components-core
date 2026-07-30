/**
 * `@keenmate/web-components-core/cem` — Custom Elements Manifest tooling
 * (SPEC §12.4). A shared analyzer config preset and a plugin that reads
 * BlissElement's `static inputs` / `static events` tables so the manifest is
 * generated from the single source of truth (structure) plus each row's
 * `description` / `deprecated` (prose). Build-time only — not imported by the
 * runtime bundle.
 */
export { blissAnalyzerConfig, type BlissAnalyzerConfig, type BlissAnalyzerOptions } from './config.js';
export { blissInputsPlugin, type CemPlugin } from './plugin.js';
export {
  extractBlissClass,
  extractBlissClasses,
  type ExtractedAttribute,
  type ExtractedClass,
  type ExtractedEvent,
  type ExtractedMember,
  type ExtractedType,
} from './extract.js';
