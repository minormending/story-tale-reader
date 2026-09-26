/**
 * Write-behind for values where only the latest matters, such as a reading position.
 *
 * At most one write per key is in flight. Values that arrive meanwhile replace one
 * another, so however fast they come, the queue never holds more than the newest,
 * and a value equal to the last one written is not written again.
 *
 * Without this, a viewer that reported its position on every render put one
 * IndexedDB transaction per render into the queue — measured at around fifty a
 * second on a cheap tablet, none of them finishing while the book was open — and
 * everything else that touched the store, opening the next book included, waited
 * behind them for minutes.
 */
export function latestOnly<V>(
  write: (key: string, value: V) => Promise<void>,
  same: (a: V, b: V) => boolean,
): (key: string, value: V) => Promise<void> {
  const state = new Map<string, { written?: V; next?: V; running?: Promise<void> }>()

  return (key, value) => {
    let entry = state.get(key)
    if (!entry) state.set(key, (entry = {}))
    const current = entry

    if (current.running) {
      current.next = value
      return current.running
    }
    if (current.written !== undefined && same(current.written, value)) return Promise.resolve()

    current.next = value
    current.running = (async () => {
      try {
        while (current.next !== undefined) {
          const pending = current.next
          current.next = undefined
          if (current.written !== undefined && same(current.written, pending)) continue
          await write(key, pending)
          current.written = pending
        }
      } finally {
        current.running = undefined
      }
    })()
    return current.running
  }
}
