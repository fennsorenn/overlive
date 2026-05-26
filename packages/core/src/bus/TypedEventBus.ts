import type { EventType, EventByType, OverliveEvent } from '../events/types.js'

type AnyHandler = (event: OverliveEvent) => void | Promise<void>
type TypedHandler<T extends EventType> = (event: EventByType<T>) => void | Promise<void>

/**
 * Subscription options passed to `on()`.
 */
export interface SubscribeOptions {
  /**
   * If true, parsed emote tokens will be injected into chat.message events
   * before the handler is called. Emote resolution runs lazily — only for
   * subscribers that request it.
   *
   * Pass an array to restrict to specific emote platforms.
   */
  resolveEmotes?: boolean | Array<'twitch' | '7tv' | 'bttv' | 'ffz'>

  /**
   * Filter to specific channels. If omitted, events from all channels fire.
   */
  channels?: string[]
}

export interface Subscription {
  /** Remove this specific handler */
  unsubscribe(): void
}

/**
 * Internal subscription entry.
 */
interface SubscriptionEntry {
  handler: AnyHandler
  options: SubscribeOptions
}

/**
 * Fully typed event bus. Consumers interact with the SDK through this.
 */
export class TypedEventBus {
  private readonly listeners = new Map<EventType | '*', Set<SubscriptionEntry>>()

  /**
   * Subscribe to a specific event type.
   */
  on<T extends EventType>(
    type: T,
    handler: TypedHandler<T>,
    options: SubscribeOptions = {},
  ): Subscription {
    return this.addListener(type, handler as AnyHandler, options)
  }

  /**
   * Subscribe to all events.
   */
  onAny(handler: (event: OverliveEvent) => void | Promise<void>, options: SubscribeOptions = {}): Subscription {
    return this.addListener('*', handler, options)
  }

  /**
   * Subscribe to a specific event type, fire once, then auto-unsubscribe.
   */
  once<T extends EventType>(type: T, handler: TypedHandler<T>): Subscription {
    let sub: Subscription
    const wrapper = (event: EventByType<T>) => {
      handler(event)
      sub.unsubscribe()
    }
    sub = this.on(type, wrapper)
    return sub
  }

  /**
   * Emit an event to all matching listeners.
   * Called internally by the bus — not part of the public consumer API.
   */
  async emit(event: OverliveEvent): Promise<void> {
    const entries = [
      ...(this.listeners.get(event.type) ?? []),
      ...(this.listeners.get('*') ?? []),
    ]

    await Promise.all(
      entries.map(async ({ handler, options }) => {
        if (!this.matchesOptions(event, options)) return
        await handler(event)
      }),
    )
  }

  private addListener(
    type: EventType | '*',
    handler: AnyHandler,
    options: SubscribeOptions,
  ): Subscription {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }

    const entry: SubscriptionEntry = { handler, options }
    this.listeners.get(type)!.add(entry)

    return {
      unsubscribe: () => {
        this.listeners.get(type)?.delete(entry)
      },
    }
  }

  private matchesOptions(event: OverliveEvent, options: SubscribeOptions): boolean {
    if (options.channels && options.channels.length > 0) {
      if (!options.channels.includes(event.channel)) return false
    }
    return true
  }

  listenerCount(type?: EventType): number {
    if (type) return this.listeners.get(type)?.size ?? 0
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}
