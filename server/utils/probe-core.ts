// Pure logic for the socket-proxy permission probe — unit-testable in isolation.
//
// The probe works by making harmless Docker API calls against deliberately
// nonexistent targets: a proxy that blocks the endpoint answers 403 before the
// daemon ever sees the request, while a permitted call reaches the daemon and
// fails with 404 (no such container/image) or succeeds (list endpoints).

export type ProbeVerdict = 'allowed' | 'blocked' | 'unknown'

export const PROBES = ['post', 'exec', 'distribution', 'images', 'networks', 'volumes'] as const
export type ProbeName = (typeof PROBES)[number]

/** Classify a probe call outcome. `null` = the call succeeded. */
export function classifyProbe(err: { statusCode?: number } | null): ProbeVerdict {
  if (!err) return 'allowed'
  if (err.statusCode === 403) return 'blocked' // the proxy's "administrative rules" answer
  if (typeof err.statusCode === 'number') return 'allowed' // reached the daemon (404 etc.)
  return 'unknown' // timeout / connection failure — no verdict
}

/** Socket-proxy permissions each capability depends on (mirrors the settings hints). */
export const CAP_REQUIREMENTS: Record<string, readonly ProbeName[]> = {
  control: ['post'],
  updateCheck: ['distribution'],
  updates: ['post', 'images'],
  stacks: ['post', 'images', 'networks', 'volumes'],
  terminal: ['post', 'exec'],
}

/** Roll individual probe results up into a per-capability verdict. */
export function capVerdict(results: Partial<Record<ProbeName, ProbeVerdict>>, cap: string): ProbeVerdict {
  const needs = CAP_REQUIREMENTS[cap] ?? []
  if (needs.some((n) => results[n] === 'blocked')) return 'blocked'
  if (needs.some((n) => results[n] !== 'allowed')) return 'unknown'
  return 'allowed'
}
