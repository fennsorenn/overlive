import type { OverliveKit, OverliveEvent, EventType } from '@overlive/core'
import { createCollectionStore } from '../collection/CollectionStore.js'
import type { CollectionStore } from '../collection/types.js'

export interface RecentEventsStoreOptions {
  /** Which event types to track. Defaults to all. */
  types?: EventType[]

  /** Maximum events to retain. Default: 50 */
  limit?: number

  channels?: string[]
  resetThreshold?: number
}

export type RecentEventsStore = CollectionStore<OverliveEvent>

export function createRecentEventsStore(
  kit: OverliveKit,
  options: RecentEventsStoreOptions = {},
): RecentEventsStore {
  const limit = options.limit ?? 50

  const store = createCollectionStore<OverliveEvent>({
    getKey: (event) => event.id,
    ...(options.resetThreshold !== undefined && { resetThreshold: options.resetThreshold }),
  })

  const push = (event: OverliveEvent) => {
    if (store.map.size >= limit) {
      const nextMap = new Map(store.map)
      const oldestKey = nextMap.keys().next().value
      if (oldestKey !== undefined) nextMap.delete(oldestKey)
      nextMap.set(event.id, event)
      store.applyMap(nextMap)
    } else {
      store.set(event)
    }
  }

  const subs: Array<{ unsubscribe(): void }> = []

  if (options.types && options.types.length > 0) {
    for (const type of options.types) {
      subs.push(
        kit.on(type as EventType, push as (e: OverliveEvent) => void, {
          ...(options.channels && { channels: options.channels }),
        }),
      )
    }
  } else {
    subs.push(kit.onAny(push, { ...(options.channels && { channels: options.channels }) }))
  }

  store.onDestroy(() => {
    for (const sub of subs) sub.unsubscribe()
  })

  return store
}
