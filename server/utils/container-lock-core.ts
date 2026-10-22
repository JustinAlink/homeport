// One recreate-style operation (update, environment change, recreate) per
// container at a time. Two at once race on the stop -> rename -> create swap:
// the second one can pick up the first one's renamed backup and leave an
// "<name>-old-<ts>" container behind. That's reachable for real when the nightly
// auto-update and a manual click overlap, or from two browser tabs.
//
// Keys are container NAMES (ids change on every recreate), and an operation
// holds both the live name and its backup name for its whole duration.

export class ContainerBusyError extends Error {
  key: string
  holder: string
  constructor(key: string, holder: string) {
    super(`"${key.replace(/^[^:]*::/, '')}" is busy: ${holder} is still running on it. Try again when that has finished.`)
    this.key = key
    this.holder = holder
  }
}

export function createContainerLock() {
  const held = new Map<string, string>()
  return {
    async run<T>(keys: string[], label: string, fn: () => Promise<T>): Promise<T> {
      const clash = keys.find((k) => held.has(k))
      if (clash) throw new ContainerBusyError(clash, held.get(clash)!)
      for (const k of keys) held.set(k, label)
      try {
        return await fn()
      } finally {
        for (const k of keys) if (held.get(k) === label) held.delete(k)
      }
    },
    isBusy: (key: string) => held.has(key),
  }
}
