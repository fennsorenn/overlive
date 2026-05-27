import type { PlatformAdapter, AdapterStateInfo } from './adapter/types.js'
import type { EventType, EventByType, OverliveEvent, AdapterEmittedEvent } from './events/types.js'

/**
 * State snapshot for one registered adapter instance.
 */
export interface AdapterStateSnapshot extends AdapterStateInfo {
  instanceId: string
  platform: string
  displayName: string
}

/**
 * Callback for kit-level adapter state changes.
 */
export type AdapterStateListener = (snapshot: AdapterStateSnapshot) => void
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

  // Per-instance latest state snapshot, plus listeners for adapter.state events.
  private readonly adapterState = new Map<string, AdapterStateSnapshot>()
  private readonly adapterStateListeners = new Set<AdapterStateListener>()

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
   * Register a platform adapter under a stable `instanceId`.
   *
   * Multiple instances of the same platform may be registered, as long as
   * each has a distinct `instanceId` (e.g. a per-account UUID). If omitted,
   * the platform name is used as the instance id — convenient for the
   * single-account case but means a second adapter of the same platform
   * must supply its own id.
   *
   * Adapters can be registered before or after calling connect().
   */
  use(adapter: PlatformAdapter, instanceId?: string): this {
    const id = instanceId ?? adapter.platform
    this.registry.register(id, adapter)

    // Seed the initial state snapshot from whatever the adapter reports
    // right after registration (typically 'disconnected').
    this.recordAdapterState(id, adapter, { state: adapter.state })

    // Subscribe to adapter state changes if it supports it. Adapters that
    // omit onStateChange just keep the seeded snapshot until connect()
    // updates `adapter.state` directly (less precise but acceptable).
    adapter.onStateChange?.((info) => {
      this.recordAdapterState(id, adapter, info)
    })

    adapter.onEvent(async (event: AdapterEmittedEvent) => {
      // Stamp the event with the registry instance id so consumers can
      // route by account when multiple adapters of the same platform exist.
      // Cast through `unknown` because Omit-of-union spread doesn't refine
      // the discriminant back to the concrete event in TS.
      const stamped = { ...event, sourceInstanceId: id } as unknown as OverliveEvent
      await this.pipeline.run(stamped, async (evt) => {
        await this.bus.emit(evt)
      })
    })

    return this
  }

  /**
   * Unregister an adapter by `instanceId` and disconnect it.
   */
  async remove(instanceId: string): Promise<void> {
    const adapter = this.registry.get(instanceId)
    if (adapter) {
      await adapter.disconnect()
      this.registry.unregister(instanceId)
      this.adapterState.delete(instanceId)
    }
  }

  // ─── Adapter state observability ──────────────────────────────────────────

  /**
   * Snapshot of the current state of every registered adapter instance.
   * Useful for rendering connection status indicators in a settings UI.
   */
  adapterStates(): AdapterStateSnapshot[] {
    return Array.from(this.adapterState.values())
  }

  /**
   * Subscribe to adapter state changes across all registered instances.
   * Fires on every state transition, including reconnects and token issues.
   * Use the snapshot's `reason` field to decide whether the user should
   * act (e.g. `'token_revoked'` → show a reconnect button).
   */
  on(event: 'adapter.state', handler: AdapterStateListener): { unsubscribe: () => void }
  /**
   * Subscribe to a specific event type. (Same as the typed overload below.)
   */
  on<T extends EventType>(
    type: T,
    handler: (event: EventByType<T>) => void | Promise<void>,
    options?: SubscribeOptions,
  ): Subscription
  on(
    typeOrEvent: EventType | 'adapter.state',
    handler: ((info: AdapterStateSnapshot) => void) | ((event: OverliveEvent) => void | Promise<void>),
    options: SubscribeOptions = {},
  ): Subscription | { unsubscribe: () => void } {
    if (typeOrEvent === 'adapter.state') {
      const listener = handler as AdapterStateListener
      this.adapterStateListeners.add(listener)
      return { unsubscribe: () => this.adapterStateListeners.delete(listener) }
    }
    return this.bus.on(
      typeOrEvent,
      handler as (event: OverliveEvent) => void | Promise<void>,
      options,
    )
  }

  private recordAdapterState(
    instanceId: string,
    adapter: PlatformAdapter,
    info: AdapterStateInfo,
  ): void {
    const snapshot: AdapterStateSnapshot = {
      instanceId,
      platform: adapter.platform,
      displayName: adapter.displayName ?? adapter.platform,
      ...info,
    }
    this.adapterState.set(instanceId, snapshot)
    for (const listener of this.adapterStateListeners) {
      try {
        listener(snapshot)
      } catch (e) {
        console.error('[overlive] adapter.state listener threw:', e)
      }
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
