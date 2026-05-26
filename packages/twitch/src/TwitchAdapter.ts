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
  private readonly channel: string

  constructor(private readonly config: TwitchAdapterConfig) {
    this.eventSub = new TwitchEventSubClient(config)
    this.rest = new TwitchRestClient(
      config.clientId,
      config.accessToken,
      config.broadcasterId,
    )

    const prefix = config.commandPrefix ?? '!'
    this.commandPrefixes = Array.isArray(prefix) ? prefix : [prefix]

    // broadcasterId is used as channel identifier throughout —
    // the REST client can resolve the login name if needed
    this.channel = config.broadcasterId

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

  // ─── EventSub dispatch ────────────────────────────────────────────────────

  private dispatch(type: string, raw: unknown): void {
    if (!this.handler) return

    try {
      switch (type) {
        case 'channel.cheer':
          this.handler(normalizeCheer(raw, this.channel))
          break
        case 'channel.channel_points_custom_reward_redemption.add':
          this.handler(normalizeRedemption(raw, this.channel))
          break
        case 'channel.subscribe':
          this.handler(normalizeSubscription(raw, this.channel))
          break
        case 'channel.subscription.message':
          this.handler(normalizeResubMessage(raw, this.channel))
          break
        case 'channel.subscription.gift':
          this.handler(normalizeGiftBomb(raw, this.channel))
          break
        case 'channel.raid':
          this.handler(normalizeRaid(raw, this.channel))
          break
        case 'channel.follow':
          this.handler(normalizeFollow(raw, this.channel))
          break
        case 'channel.ban':
          this.handler(normalizeBan(raw, this.channel))
          break
        case 'channel.chat.message': {
          const event = normalizeChatMessage(raw, {
            commandPrefixes: this.commandPrefixes,
            channel: this.channel,
          })
          if (event) this.handler(event)
          break
        }
        case 'channel.chat.message_delete':
          this.handler(normalizeChatMessageDelete(raw, this.channel))
          break
        case 'channel.ad_break.begin':
          this.handler(normalizeAdBreak(raw, this.channel))
          break
        case 'stream.online':
          this.handler(normalizeStreamOnline(raw, this.channel))
          break
        case 'stream.offline':
          this.handler(normalizeStreamOffline(raw, this.channel))
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
