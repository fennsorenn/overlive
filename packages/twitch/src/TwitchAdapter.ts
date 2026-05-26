import type {
  PlatformAdapter,
  AdapterEventHandler,
  ConnectionState,
  SuppressionMap,
  RestCapableAdapter,
} from '@overlive/core'
import type { TwitchAdapterConfig } from './config.js'
import { TwitchEventSubClient } from './EventSubClient.js'
import { TwitchRestClient } from './TwitchRestClient.js'
import {
  normalizeCheer,
  normalizeRedemption,
  normalizeSubscription,
  normalizeResubMessage,
  normalizeGiftBomb,
  normalizeRaid,
  normalizeFollow,
  normalizeBan,
  normalizeAdBreak,
  normalizeStreamOnline,
  normalizeStreamOffline,
  normalizeChatMessage,
  normalizeChatMessageDelete,
  type ChannelRef,
} from './normalizers.js'

export class TwitchAdapter implements RestCapableAdapter {
  readonly platform = 'twitch' as const
  readonly displayName = 'Twitch'

  /**
   * Twitch is the highest-priority adapter — other adapters' suppressedBy
   * maps reference 'twitch', not the other way around.
   */
  readonly suppressedBy: SuppressionMap = {}

  private _state: ConnectionState = 'disconnected'
  private handler: AdapterEventHandler | null = null
  private stateHandler: ((state: ConnectionState) => void) | null = null

  private readonly eventSub: TwitchEventSubClient
  readonly rest: TwitchRestClient

  private readonly commandPrefixes: string[]
  /**
   * Human-readable broadcaster login (e.g. "twitchplays"). Initially set to
   * the broadcaster id and replaced with the resolved login during connect.
   * Stamped as `channel` on every event.
   */
  private channel: string
  /** Platform-native broadcaster id. Stamped as `channelId` on every event. */
  private readonly channelId: string

  constructor(private readonly config: TwitchAdapterConfig) {
    this.eventSub = new TwitchEventSubClient(config)
    this.rest = new TwitchRestClient(
      config.clientId,
      config.accessToken,
      config.broadcasterId,
    )

    const prefix = config.commandPrefix ?? '!'
    this.commandPrefixes = Array.isArray(prefix) ? prefix : [prefix]

    // Initial channel value is the broadcaster id; on connect we resolve it
    // to the broadcaster's login so events carry the human-readable slug.
    // Until resolved (or if resolution fails), we fall back to the id.
    this.channel = config.broadcasterId
    this.channelId = config.broadcasterId

    this.eventSub.onEvent((type, event) => {
      this.dispatch(type, event)
    })
  }

  get state(): ConnectionState {
    return this._state
  }

  onEvent(handler: AdapterEventHandler): void {
    this.handler = handler
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateHandler = handler
  }

  async connect(): Promise<void> {
    this.setState('connecting')
    try {
      // Resolve the broadcaster login so events carry the human-readable
      // slug rather than the numeric id. Failures here are non-fatal —
      // the adapter falls back to the id-as-channel.
      try {
        const user = await this.rest.getUserById(this.config.broadcasterId)
        if (user?.login) this.channel = user.login
      } catch {
        // ignored — connection still proceeds with id-as-channel fallback
      }
      await this.eventSub.connect()
      this.setState('connected')
    } catch (e) {
      this.setState('error')
      throw e
    }
  }

  async disconnect(): Promise<void> {
    await this.eventSub.disconnect()
    this.setState('disconnected')
  }

  private get channelRef(): ChannelRef {
    return { slug: this.channel, id: this.channelId }
  }

  // ─── EventSub dispatch ────────────────────────────────────────────────────

  private dispatch(type: string, raw: unknown): void {
    if (!this.handler) return

    const ref = this.channelRef

    try {
      switch (type) {
        case 'channel.cheer':
          this.handler(normalizeCheer(raw, ref))
          break
        case 'channel.channel_points_custom_reward_redemption.add':
          this.handler(normalizeRedemption(raw, ref))
          break
        case 'channel.subscribe':
          this.handler(normalizeSubscription(raw, ref))
          break
        case 'channel.subscription.message':
          this.handler(normalizeResubMessage(raw, ref))
          break
        case 'channel.subscription.gift':
          this.handler(normalizeGiftBomb(raw, ref))
          break
        case 'channel.raid':
          this.handler(normalizeRaid(raw, ref))
          break
        case 'channel.follow':
          this.handler(normalizeFollow(raw, ref))
          break
        case 'channel.ban':
          this.handler(normalizeBan(raw, ref))
          break
        case 'channel.chat.message': {
          const event = normalizeChatMessage(raw, {
            commandPrefixes: this.commandPrefixes,
            channelRef: ref,
          })
          if (event) this.handler(event)
          break
        }
        case 'channel.chat.message_delete':
          this.handler(normalizeChatMessageDelete(raw, ref))
          break
        case 'channel.ad_break.begin':
          this.handler(normalizeAdBreak(raw, ref))
          break
        case 'stream.online':
          this.handler(normalizeStreamOnline(raw, ref))
          break
        case 'stream.offline':
          this.handler(normalizeStreamOffline(raw, ref))
          break
      }
    } catch (e) {
      console.error(`[overlive:twitch] Error normalizing ${type}:`, e)
    }
  }

  private setState(state: ConnectionState): void {
    this._state = state
    this.stateHandler?.(state)
  }
}
