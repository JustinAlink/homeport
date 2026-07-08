import { lockRemaining, recordFailure, globalLockRemaining, recordGlobalFailure, type LoginRate } from './auth-core'

// Shared rate limiting for "re-enter the current password while already
// logged in" endpoints (change password, disable 2FA, regenerate recovery
// codes). One shared limiter across all three so a session-holding attacker
// can't dodge the lockout by round-robining across the different actions.
const attempts = new Map<string, LoginRate>()
const MAP_CAP = 10_000
let globalRate: LoginRate | undefined

/** ms until this client may attempt a re-auth again (0 = allowed). */
export function reauthWaitMs(ip: string, now: number): number {
  const gWait = globalLockRemaining(globalRate, now)
  if (gWait > 0) return gWait
  return lockRemaining(attempts.get(ip), now)
}

export function recordReauthFailure(ip: string, now: number): void {
  if (attempts.size >= MAP_CAP) attempts.clear() // crude but bounded
  attempts.set(ip, recordFailure(attempts.get(ip), now))
  globalRate = recordGlobalFailure(globalRate, now)
}

export function recordReauthSuccess(ip: string): void {
  attempts.delete(ip)
}
