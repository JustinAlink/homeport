/**
 * Wrap an async fn so overlapping invocations are skipped: while one run is in
 * flight, further calls resolve to null immediately. Standalone (no heavy imports)
 * so it can be unit-tested in isolation.
 */
export function guard<T>(fn: () => Promise<T>): () => Promise<T | null> {
  let running = false
  return async () => {
    if (running) return null
    running = true
    try {
      return await fn()
    } finally {
      running = false
    }
  }
}
