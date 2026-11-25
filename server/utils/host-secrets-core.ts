// Secrets in the settings form follow one rule: never sent to the browser, and a
// blank field on save keeps the stored value. The Traefik API password adds one
// guard: it is kept only while the API URL still points at the same server, so
// changing the URL can never send the stored password somewhere new without it
// being typed in again. Pure, unit-tested.

export interface HostSecretFields {
  id?: string
  name?: string
  traefikApiUrl?: string
  traefikApiPassword?: string
}

export type MaskedHost<T extends HostSecretFields = HostSecretFields> = T & { traefikApiPassword: string; traefikApiPasswordSet: boolean }

/** Hosts for the settings view: the password blanked, with a flag saying one is stored. */
export function maskHostSecrets<T extends HostSecretFields>(hosts: T[]): MaskedHost<T>[] {
  return hosts.map((h) => ({ ...h, traefikApiPassword: '', traefikApiPasswordSet: !!h.traefikApiPassword }))
}

const originOf = (url: string | undefined) => {
  try {
    return new URL(String(url || '').trim()).origin
  } catch {
    return ''
  }
}

/**
 * The password to store: a typed one wins; a blank one keeps the stored password
 * only when the URL's origin is unchanged; otherwise none.
 */
export function keptPassword(typed: string | undefined, stored: string | undefined, newUrl: string | undefined, storedUrl: string | undefined): string {
  if (typed) return typed
  if (!stored) return ''
  const o = originOf(newUrl)
  return o && o === originOf(storedUrl) ? stored : ''
}

/**
 * Reunite saved hosts with their stored passwords. A host is the same host when its
 * id matches, or (no id) its name: never by position, or deleting one row would
 * hand its password to the next.
 */
export function mergeHostSecrets<T extends HostSecretFields>(incoming: T[], existing: HostSecretFields[]): T[] {
  return incoming.map((h) => {
    const prev = h.id ? existing.find((e) => e.id === h.id) : existing.find((e) => !e.id && e.name === h.name)
    return { ...h, traefikApiPassword: keptPassword(h.traefikApiPassword, prev?.traefikApiPassword, h.traefikApiUrl, prev?.traefikApiUrl) }
  })
}
