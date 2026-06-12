// Service ids are `${hostId}::${containerId}`. One place to split them.
export function splitServiceId(id: string): { hostId: string; containerId: string } {
  const sep = id.indexOf('::')
  return sep >= 0
    ? { hostId: id.slice(0, sep), containerId: id.slice(sep + 2) }
    : { hostId: 'default', containerId: id }
}
