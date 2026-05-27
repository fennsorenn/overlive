import type { OverliveKit, ChatMessageEvent } from '@overlive/core'
import { createCollectionStore } from '../collection/CollectionStore.js'
import type { CollectionStore } from '../collection/types.js'

export interface ChatStoreOptions {
  /**
   * Maximum number of messages to retain.
   * When exceeded, oldest messages are rotated out.
   * Default: 100
   */
  limit?: number

  /** Filter to specific channels. Defaults to all. */
  channels?: string[]

  /**
   * Whether to resolve emotes in messages.
   * Passed through to the event subscription.
   */
  resolveEmotes?: boolean | Array<'twitch' | '7tv' | 'bttv' | 'ffz'>

  /**
   * Fraction of key overlap below which a reset is emitted.
   * Default: 0.5
   */
  resetThreshold?: number

  /**
   * Optional filter function — return false to exclude a message.
   */
  filter?: (msg: ChatMessageEvent) => boolean

  /**
   * Initial messages to seed the store with (e.g. from REST history).
   */
  initialMessages?: ChatMessageEvent[]
}

export type ChatStore = CollectionStore<ChatMessageEvent>

export function createChatStore(
  kit: OverliveKit,
  options: ChatStoreOptions = {},
): ChatStore & { seed(messages: ChatMessageEvent[]): void } {
  const limit = options.limit ?? 100

  const store = createCollectionStore<ChatMessageEvent>({
    getKey: (msg) => msg.data.messageId,
    ...(options.resetThreshold !== undefined && { resetThreshold: options.resetThreshold }),
    ...(options.initialMessages && { initialItems: options.initialMessages }),
  })

  const sub = kit.on(
    'chat.message',
    (msg) => {
      if (options.filter && !options.filter(msg)) return

      // If at limit, rotate — build new map without the oldest entry,
      // then add the new message. One diff cycle covers both operations,
      // which the diff algorithm will see as a remove + insert (or reset
      // if the threshold is crossed, which it won't be for a single rotation).
      if (store.map.size >= limit) {
        const nextMap = new Map(store.map)
        const oldestKey = nextMap.keys().next().value
        if (oldestKey !== undefined) nextMap.delete(oldestKey)
        nextMap.set(msg.data.messageId, msg)
        store.applyMap(nextMap)
      } else {
        store.set(msg)
      }
    },
    {
      ...(options.channels && { channels: options.channels }),
      ...(options.resolveEmotes !== undefined && { resolveEmotes: options.resolveEmotes }),
    },
  )

  // Also handle message deletions — remove by messageId
  const deleteSub = kit.on(
    'chat.delete',
    (event) => {
      store.delete(event.data.messageId)
    },
    { ...(options.channels && { channels: options.channels }) },
  )

  store.onDestroy(() => {
    sub.unsubscribe()
    deleteSub.unsubscribe()
  })

  return Object.assign(store, {
    /** Seed with historical messages (e.g. from REST). Respects limit. */
    seed(messages: ChatMessageEvent[]): void {
      const toLoad = messages.slice(-limit)
      store.setMany(toLoad)
    },
  })
}
