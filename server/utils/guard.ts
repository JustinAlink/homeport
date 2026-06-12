/**
 * Wrap an async fn so overlapping invocations are skipped: while one run is in
 * flight, further calls resolve to null immediately. Arguments pass through.
 * Standalone (no heavy imports) so it can be unit-tested in isolation.
 */
export function guard<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T | null> {
  let running = false
  return async (...args: A) => {
    if (running) return null
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
    }
  }
}
