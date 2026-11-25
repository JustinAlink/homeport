// Out-of-order guard for requests that can overlap (search-as-you-type, a graph
// range switched while the previous range still loads). Responses don't arrive
// in the order they were sent: a slow "24h" answer landing after a fast "1h" one
// would paint 24h data under the 1h label. Each request takes a ticket, and only
// the newest ticket may write its result.
export function requestSequence() {
  let last = 0
  return {
    /** Start a request. The returned check stays true until a newer request starts (or invalidate()). */
    start(): () => boolean {
      const id = ++last
      return () => id === last
    },
    /** Drop whatever is in flight, e.g. the search box was cleared. */
    invalidate(): void {
      last++
    },
  }
}
