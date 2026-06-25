import type {
  AdapterEventHandler,
  ConnectionState,
  SuppressionMap,
  RestCapableAdapter,
  AdapterStateInfo,
  AdapterStateReason,
} from '@overlive/core'
import type { TwitchAdapterConfig } from './config.js'
import { TwitchEventSubClient } from './EventSubClient.js'
import { TwitchRestClient } from './TwitchRestClient.js'
import { refreshAccessToken } from '@overlive/twitch-oauth'
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
  private stateHandler: ((info: AdapterStateInfo) => void) | null = null

  private readonly eventSub: TwitchEventSubClient
  readonly rest: TwitchRestClient

  private commandPrefixes: string[]
  /**
   * Human-readable broadcaster login (e.g. "twitchplays"). Initially set to
   * the broadcaster id and replaced with the resolved login during connect.
   * Stamped as `channel` on every event.
   */
  private channel: string
  /** Platform-native broadcaster id. Stamped as `channelId` on every event. */
  private readonly channelId: string

  // Current refresh token — mutable so we can persist the rotated value
  // Twitch may hand back on each refresh.
  private refreshToken: string | undefined

  constructor(private readonly config: TwitchAdapterConfig) {
    this.eventSub = new TwitchEventSubClient(config)
    this.rest = new TwitchRestClient(
      config.clientId,
      config.accessToken,
      config.broadcasterId,
    )
    this.refreshToken = config.refreshToken

    // Install the 401 → refresh hook on REST and EventSub only if we have
    // the bits to refresh.
    if (config.clientSecret && this.refreshToken) {
      const hook = () => this.refreshAndRotate()
      this.rest._setOn401(hook)
      this.eventSub.setOn401Hook(hook)
    }

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

  /**
   * Refresh the access token using the stored refresh token. Updates the
   * REST client, persists the new tokens via onTokenRefreshed, and returns
   * the new access token. Throws on permanent failure (refresh token
   * revoked / expired) — caller should treat as needs-reauth.
   */
  private async refreshAndRotate(): Promise<string> {
    if (!this.config.clientSecret || !this.refreshToken) {
      throw new Error('TwitchAdapter: cannot refresh — clientSecret or refreshToken missing')
    }
    try {
      const tokens = await refreshAccessToken({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        refreshToken: this.refreshToken,
      })
      this.refreshToken = tokens.refreshToken
      this.rest.setAccessToken(tokens.accessToken)
      this.eventSub.setAccessToken(tokens.accessToken)
      await this.config.onTokenRefreshed?.({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      })
      return tokens.accessToken
    } catch (e) {
      // Refresh token is dead — the user must reauth.
      this.setState('error', {
        reason: 'token_revoked',
        message: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  get state(): ConnectionState {
    return this._state
  }

  onEvent(handler: AdapterEventHandler): void {
    this.handler = handler
  }

  onStateChange(handler: (info: AdapterStateInfo) => void): void {
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
      // Surface scope problems via state — vspark renders a warning when
      // some subscriptions were skipped because the token lacks the scope.
      const subs = this.eventSub.getSubscriptionResults()
      const missing = subs.filter((s) => s.status === 'scope_missing' || s.status === 'forbidden')
      if (missing.length > 0) {
        this.setState('connected', {
          reason: 'scope_missing',
          message: `${missing.length} event type(s) unavailable due to missing scopes or affiliate eligibility: ${missing.map((m) => m.type).join(', ')}`,
        })
      } else {
        this.setState('connected')
      }
    } catch (e) {
      this.setState('error', classifyConnectError(e))
      throw e
    }
  }

  /**
   * Per-subscription outcome from the last connect. Use this to render a
   * detailed "which event types work" indicator in the Accounts UI.
   */
  subscriptionResults() {
    return this.eventSub.getSubscriptionResults()
  }

  async disconnect(): Promise<void> {
    await this.eventSub.disconnect()
    this.setState('disconnected')
  }

  /**
   * Send a chat message to the broadcaster's channel as the broadcaster's own
   * account. Requires the `user:write:chat` scope on the access token.
   */
  async sendChatMessage(text: string): Promise<void> {
    await this.rest.sendChatMessage(text)
  }

  /**
   * Replace the command-prefix(es) used to detect chat commands. Takes
   * effect for subsequent messages — no reconnect required.
   */
  setCommandPrefix(prefix: string | string[]): void {
    this.commandPrefixes = Array.isArray(prefix) ? prefix : [prefix]
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

  private setState(
    state: ConnectionState,
    detail?: { reason?: AdapterStateReason; message?: string },
  ): void {
    this._state = state
    const info: AdapterStateInfo = {
      state,
      ...(detail?.reason !== undefined && { reason: detail.reason }),
      ...(detail?.message !== undefined && { message: detail.message }),
    }
    this.stateHandler?.(info)
  }
}

/**
 * Classify a connect-time error so consumers can decide whether the user
 * needs to reauth, retry, or just see an error message.
 */
function classifyConnectError(e: unknown): { reason: AdapterStateReason; message: string } {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (lower.includes('401') || lower.includes('unauthorized')) {
    return { reason: 'token_expired', message: msg }
  }
  if (lower.includes('403') || lower.includes('forbidden') || lower.includes('scope')) {
    return { reason: 'scope_missing', message: msg }
  }
  if (lower.includes('econn') || lower.includes('network') || lower.includes('etimedout')) {
    return { reason: 'network', message: msg }
  }
  return { reason: 'unknown', message: msg }
}
