/**
 * Opt-in performance logger (treeview's `perfStart`/`perfEnd`/`perfMeasure`/
 * `perfSummary`, SPEC §12.1). Logs through a `NAMESPACE:PERF` colored logger,
 * so timings appear only when logging is enabled at `debug` or below.
 */
import { createLoggers } from './create-loggers.js';

export interface PerfLogger {
  /** Mark the start of a span. */
  start(label: string): void;
  /** Close a span opened by {@link start}; returns elapsed ms (0 if never started). */
  end(label: string): number;
  /** Time a synchronous function, record the span, and return its result. */
  measure<T>(label: string, fn: () => T): T;
  /** Log every recorded span plus a total. */
  summary(): void;
  /** Drop all open marks and recorded spans. */
  clear(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

export function createPerfLogger(namespace: string): PerfLogger {
  const logger = createLoggers(namespace, ['PERF'] as const).loggers.PERF;
  const marks = new Map<string, number>();
  const spans: { label: string; ms: number }[] = [];

  const record = (label: string, ms: number): void => {
    spans.push({ label, ms });
    logger.debug(`${label} took ${ms.toFixed(2)}ms`);
  };

  return {
    start(label) {
      marks.set(label, now());
    },
    end(label) {
      const started = marks.get(label);
      if (started === undefined) {
        logger.warn(`end("${label}") called with no matching start()`);
        return 0;
      }
      marks.delete(label);
      const ms = now() - started;
      record(label, ms);
      return ms;
    },
    measure(label, fn) {
      const started = now();
      const result = fn();
      record(label, now() - started);
      return result;
    },
    summary() {
      if (spans.length === 0) {
        logger.debug('no measurements recorded');
        return;
      }
      const total = spans.reduce((sum, s) => sum + s.ms, 0);
      logger.debug(`summary — ${spans.length} spans, ${total.toFixed(2)}ms total:`);
      for (const s of spans) logger.debug(`  ${s.label}: ${s.ms.toFixed(2)}ms`);
    },
    clear() {
      marks.clear();
      spans.length = 0;
    },
  };
}
