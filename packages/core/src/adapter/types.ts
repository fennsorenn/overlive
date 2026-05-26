import type { AdapterEmittedEvent, EventType, Platform } from '../events/types.js'

// ─── Suppression map ─────────────────────────────────────────────────────────

/**
 * Maps event types this adapter can emit to an array of platform identifiers
 * that take precedence. If any of those platforms are registered on the same
 * bus, this adapter will suppress that event type automatically.
 *
 * Example (StreamElements adapter):
 * {
 *   subscription: ['twitch'],  // SE fires on subs, but Twitch has richer data
 *   raid:         ['twitch'],
 *   follow:       ['twitch'],
 *   // 'redemption' (tips) intentionally absent — SE owns that, Twitch doesn't
 * }
 */
export type SuppressionMap = Partial<Record<EventType, Platform[]>>

// ─── Adapter event handler ────────────────────────────────────────────────────

/**
 * Adapters emit `AdapterEmittedEvent`s — i.e. fully-formed `OverliveEvent`s
 * minus `sourceInstanceId`, which the SDK stamps as the event passes through
 * the kit. Normalizers therefore never need to know their adapter's id.
 */
export type AdapterEventHandler = (event: AdapterEmittedEvent) => void

// ─── Connection state ────────────────────────────────────────────────────────

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface PlatformAdapter {
  /** Unique platform identifier — must match Platform type */
  readonly platform: Platform

  /**
   * Human-readable name for logging/debugging.
   * Defaults to platform if not provided.
   */
  readonly displayName?: string

  /**
   * Declares which event types this adapter suppresses when a higher-priority
   * adapter is present. Core reads this at registration time.
   */
  readonly suppressedBy: SuppressionMap

  /** Current connection state */
  readonly state: ConnectionState

  /**
   * Connect to the platform. Called automatically by the SDK when
   * `kit.connect()` is called, or immediately if already connected.
   */
  connect(): Promise<void>

  /**
   * Gracefully disconnect from the platform.
   */
  disconnect(): Promise<void>

  /**
   * Register the internal event handler. Called by the bus once the adapter
   * is registered. The adapter must call this handler for every event it
   * wants to emit to the bus.
   */
  onEvent(handler: AdapterEventHandler): void

  /**
   * Register a handler for state changes.
   */
  onStateChange?(handler: (state: ConnectionState) => void): void
}

// ─── REST adapter interface ───────────────────────────────────────────────────

/**
 * Optional extension of PlatformAdapter for adapters that also expose
 * REST API access.
 */
export interface RestCapableAdapter extends PlatformAdapter {
  readonly rest: AdapterRestClient
}

export interface AdapterRestClient {
  readonly platform: Platform
}

export function isRestCapable(adapter: PlatformAdapter): adapter is RestCapableAdapter {
  return 'rest' in adapter && adapter.rest != null
}
