export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

/** Exponential backoff with ±20% jitter: base, 2×base, 4×base … capped at maxMs. */
export function computeBackoffMs(attempt: number, options: BackoffOptions): number {
  const random = options.random ?? Math.random;
  const exponential = options.baseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(options.maxMs, exponential);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(Math.min(options.maxMs, capped * jitter));
}
