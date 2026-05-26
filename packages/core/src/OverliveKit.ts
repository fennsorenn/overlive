import type { PlatformAdapter } from './adapter/types.js'
import type { EventType, EventByType, OverliveEvent } from './events/types.js'
import type { SubscribeOptions, Subscription } from './bus/TypedEventBus.js'
import type { Middleware } from './middleware/pipeline.js'

import { AdapterRegistry } from './adapter/AdapterRegistry.js'
import { TypedEventBus } from './bus/TypedEventBus.js'
import { MiddlewarePipeline, createSuppressionMiddleware } from './middleware/pipeline.js'
import { UnifiedRestClient } from './rest/UnifiedRestClient.js'

export interface OverliveKitOptions {
  /**
   * Command prefix for chat commands. Defaults to "!".
   * Pass an array to support multiple prefixes.
   */
  commandPrefix?: string | string[]

  /**
   * If true, logs every event to console. Useful during development.
   */
  debug?: boolean
}

export class OverliveKit {
  private readonly registry: AdapterRegistry
  private readonly bus: TypedEventBus
  private readonly pipeline: MiddlewarePipeline
  private readonly options: Required<OverliveKitOptions>

  /** Unified REST client — access data across all registered platforms */
  readonly rest: UnifiedRestClient

  constructor(options: OverliveKitOptions = {}) {
    this.options = {
      commandPrefix: options.commandPrefix ?? '!',
      debug: options.debug ?? false,
    }

    this.registry = new AdapterRegistry()
    this.bus = new TypedEventBus()
    this.pipeline = new MiddlewarePipeline()
    this.rest = new UnifiedRestClient(this.registry)

    // Built-in suppression middleware — runs first
    this.pipeline.use(
      createSuppressionMiddleware(
        () => this.registry.registeredPlatforms(),
        (platform) => this.registry.get(platform)?.suppressedBy ?? {},
      ),
    )

    if (this.options.debug) {
      this.pipeline.use(async (event, next) => {
        console.log(`[overlive:debug] ${event.platform} → ${event.type}`, event)
        await next(event)
      })
    }
  }

  // ─── Adapter management ───────────────────────────────────────────────────

  /**
   * Register a platform adapter.
   * Adapters can be registered before or after calling connect().
   */
  use(adapter: PlatformAdapter): this {
    this.registry.register(adapter)

    adapter.onEvent(async (event) => {
      await this.pipeline.run(event, async (evt) => {
        await this.bus.emit(evt)
      })
    })

    return this
  }

  /**
   * Unregister a platform adapter and disconnect it.
   */
  async remove(platform: string): Promise<void> {
    const adapter = this.registry.get(platform)
    if (adapter) {
      await adapter.disconnect()
      this.registry.unregister(platform)
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Connect all registered adapters.
   */
  async connect(): Promise<void> {
    const adapters = this.registry.getAll()
    await Promise.all(adapters.map((a) => a.connect()))
  }

  /**
   * Disconnect all registered adapters.
   */
  async disconnect(): Promise<void> {
    const adapters = this.registry.getAll()
    await Promise.all(adapters.map((a) => a.disconnect()))
  }

  // ─── Event subscription ───────────────────────────────────────────────────

  /**
   * Subscribe to a specific event type.
   *
   * @example
   * kit.on('redemption', (e) => console.log(e.data.currency))
   * kit.on('chat.message', handler, { resolveEmotes: true })
   * kit.on('chat.command', handler, { channels: ['mychannel'] })
   */
  on<T extends EventType>(
    type: T,
    handler: (event: EventByType<T>) => void | Promise<void>,
    options: SubscribeOptions = {},
  ): Subscription {
    return this.bus.on(type, handler, options)
  }

  /**
   * Subscribe to all events from all platforms.
   */
  onAny(
    handler: (event: OverliveEvent) => void | Promise<void>,
    options: SubscribeOptions = {},
  ): Subscription {
    return this.bus.onAny(handler, options)
  }

  /**
   * Subscribe to an event type, fire once, then auto-unsubscribe.
   */
  once<T extends EventType>(
    type: T,
    handler: (event: EventByType<T>) => void | Promise<void>,
  ): Subscription {
    return this.bus.once(type, handler)
  }

  // ─── Middleware ───────────────────────────────────────────────────────────

  /**
   * Add custom middleware to the event pipeline.
   * Middleware runs after built-in suppression, in registration order.
   *
   * @example
   * kit.middleware(async (event, next) => {
   *   if (event.channel !== 'mychannel') return // drop
   *   await next(event)
   * })
   */
  middleware(fn: Middleware): this {
    this.pipeline.use(fn)
    return this
  }

  // ─── Introspection ────────────────────────────────────────────────────────

  get adapters(): PlatformAdapter[] {
    return this.registry.getAll()
  }
}
