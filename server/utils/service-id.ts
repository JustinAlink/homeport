// Service ids are `${hostId}::${containerId}`. One place to split them.
export function splitServiceId(id: string): { hostId: string; containerId: string } {
  const sep = id.indexOf('::')
  return sep >= 0
    ? { hostId: id.slice(0, sep), containerId: id.slice(sep + 2) }
    : { hostId: 'default', containerId: id }
}

/**
 * Make host ids unique, keeping the first of each as it is: `pi`, `pi-2`, `pi-3`.
 * Ids are slugs of the host's id or name, so "Pi" and "pi" (or "my nas" and "my-nas")
 * came out the same, and every lookup by id then answered with the first host: the
 * second host's containers were listed, controlled and checked on the first machine.
 * Order-stable, so ids don't move while the host list doesn't.
 */
export function uniqueIds(ids: string[]): string[] {
  const used = new Set<string>()
  return ids.map((id) => {
    let out = id
    for (let n = 2; used.has(out); n++) out = `${id}-${n}`
    used.add(out)
    return out
  })
}
