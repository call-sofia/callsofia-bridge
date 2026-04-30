export interface BackoffOpts {
  baseMs: number;
  maxMs: number;
}

/**
 * Exponential backoff with jitter (±25% of computed delay).
 * Attempt 1 ~= baseMs, doubles each time, capped at maxMs.
 */
export function computeBackoff(attempt: number, { baseMs, maxMs }: BackoffOpts): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = 0.75 + Math.random() * 0.5;
  return exp * jitter;
}

// Full message processing wired to adapters in Task 23.
