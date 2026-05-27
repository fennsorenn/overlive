import type { TwitchAdapterConfig } from './config.js'
import type { TwitchScope } from '@overlive/twitch-oauth'
import { validateAccessToken } from '@overlive/twitch-oauth'

export type EventSubHandler = (subscriptionType: string, event: unknown) => void

/**
 * Outcome of attempting a single EventSub subscription. Surfaces individual
 * failures rather than failing the whole connect.
 */
export interface SubscriptionResult {
  type: string
  status: 'ok' | 'scope_missing' | 'forbidden' | 'failed'
  reason?: string
  /** When status is 'scope_missing', the scope(s) the token didn't have. */
  missingScopes?: TwitchScope[]
}

/**
 * Mapping from EventSub subscription type to the Twitch OAuth scopes Twitch
 * requires the access token to hold. Used by the pre-flight scope checker
 * to skip subscriptions that will obviously 403.
 *
 * Source: https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
 */
const SUBSCRIPTION_SCOPES: Record<string, TwitchScope[]> = {
  'channel.cheer':                                       ['bits:read'],
  'channel.subscribe':                                    ['channel:read:subscriptions'],
  'channel.subscription.gift':                            ['channel:read:subscriptions'],
  'channel.subscription.message':                         ['channel:read:subscriptions'],
  'channel.channel_points_custom_reward_redemption.add':  ['channel:read:redemptions'],
  'channel.raid':                                         [],
  'channel.follow':                                       ['moderator:read:followers'],
  'channel.ban':                                          ['channel:moderate'],
  'channel.chat.message':                                 ['user:read:chat'],
  'channel.chat.message_delete':                          ['moderator:read:chat_messages'],
  'channel.ad_break.begin':                               ['channel:read:ads'],
  'stream.online':                                        [],
  'stream.offline':                                       [],
}

interface EventSubMessage {
  metadata: {
    message_type: string
    subscription_type?: string
  }
  payload: {
    session?: { id: string }
    subscription?: { type: string }
    event?: unknown
  }
}

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 10

export class TwitchEventSubClient {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private handler: EventSubHandler | null = null
  private reconnectAttempts = 0
  private shouldReconnect = true
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null

  /** Last subscription attempt outcomes — refreshed on every connect. */
  private lastResults: SubscriptionResult[] = []

  // Dynamic access token getter — set by the adapter so refreshes are
  // immediately reflected in subscription requests.
  private getAccessToken: () => string
  /**
   * Refresh-and-retry hook, installed by the adapter when refresh creds are
   * available. Returns the new access token; throws to surface a permanent
   * failure.
   */
  private on401: (() => Promise<string>) | null = null

  constructor(private readonly config: TwitchAdapterConfig) {
    this.getAccessToken = () => config.accessToken
  }

  /** Replace the access token used for subscription requests. */
  setAccessToken(token: string): void {
    this.getAccessToken = () => token
  }

  /** Install the 401-refresh hook (the adapter wires this up). */
  setOn401Hook(hook: (() => Promise<string>) | null): void {
    this.on401 = hook
  }

  onEvent(handler: EventSubHandler): void {
    this.handler = handler
  }

  /**
   * Per-subscription results from the most recent subscribeToAll(). Useful
   * for surfacing scope problems to the user.
   */
  getSubscriptionResults(): SubscriptionResult[] {
    return this.lastResults
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true
      this.openSocket(resolve, reject)
    })
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.clearKeepalive()
    this.ws?.close()
    this.ws = null
    this.sessionId = null
  }

  private openSocket(
    onReady?: () => void,
    onError?: (e: Error) => void,
  ): void {
    const ws = new WebSocket(EVENTSUB_URL)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
    }

    ws.onmessage = async (raw) => {
      let msg: EventSubMessage
      try {
        msg = JSON.parse(raw.data as string) as EventSubMessage
      } catch {
        return
      }
      await this.handleMessage(msg, onReady, onError)
    }

    ws.onerror = (e) => {
      onError?.(new Error(`EventSub WebSocket error: ${String(e)}`))
    }

    ws.onclose = () => {
      this.clearKeepalive()
      if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++
        setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS * this.reconnectAttempts)
      }
    }
  }

  private async handleMessage(
    msg: EventSubMessage,
    onReady?: () => void,
    onError?: (e: Error) => void,
  ): Promise<void> {
    const type = msg.metadata.message_type

    if (type === 'session_welcome') {
      this.sessionId = msg.payload.session?.id ?? null
      if (!this.sessionId) {
        onError?.(new Error('EventSub: no session id in welcome message'))
        return
      }
      try {
        await this.subscribeToAll()
        this.resetKeepalive()
        onReady?.()
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)))
      }
      return
    }

    if (type === 'session_keepalive') {
      this.resetKeepalive()
      return
    }

    if (type === 'session_reconnect') {
      this.ws?.close()
      return
    }

    if (type === 'notification') {
      this.resetKeepalive()
      const subType = msg.metadata.subscription_type
      if (subType && msg.payload.event) {
        this.handler?.(subType, msg.payload.event)
      }
    }
  }

  private async subscribeToAll(): Promise<void> {
    const subscriptions = [
      { type: 'channel.cheer',                                       version: '1' },
      { type: 'channel.subscribe',                                    version: '1' },
      { type: 'channel.subscription.gift',                            version: '1' },
      { type: 'channel.subscription.message',                         version: '1' },
      { type: 'channel.channel_points_custom_reward_redemption.add',  version: '1' },
      { type: 'channel.raid',                                         version: '1' },
      { type: 'channel.follow',                                       version: '2' },
      { type: 'channel.ban',                                          version: '1' },
      { type: 'channel.chat.message',                                 version: '1' },
      { type: 'channel.chat.message_delete',                          version: '1' },
      { type: 'channel.ad_break.begin',                               version: '1' },
      { type: 'stream.online',                                        version: '1' },
      { type: 'stream.offline',                                       version: '1' },
    ]

    // Pre-flight scope check: ask Twitch what scopes the current token
    // actually has, then skip subscriptions that will obviously 403.
    // If validate itself fails, we proceed without skipping — the per-type
    // tolerant subscribe still surfaces failures.
    let grantedScopes: Set<TwitchScope> | null = null
    try {
      const v = await validateAccessToken(this.getAccessToken())
      grantedScopes = new Set(v.scopes)
    } catch {
      grantedScopes = null
    }

    this.lastResults = await Promise.all(
      subscriptions.map(async (sub): Promise<SubscriptionResult> => {
        // Scope pre-check
        if (grantedScopes) {
          const required = SUBSCRIPTION_SCOPES[sub.type] ?? []
          const missing = required.filter((s) => !grantedScopes!.has(s))
          if (missing.length > 0) {
            return { type: sub.type, status: 'scope_missing', missingScopes: missing }
          }
        }
        // Try to subscribe — tolerant of per-type failure
        try {
          await this.createSubscription(sub.type, sub.version)
          return { type: sub.type, status: 'ok' }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // Twitch 403 for cheers/subs on non-affiliate channels, scope
          // mismatches, etc. — classify so consumers can show the right hint.
          if (msg.includes('403')) {
            return { type: sub.type, status: 'forbidden', reason: msg }
          }
          return { type: sub.type, status: 'failed', reason: msg }
        }
      }),
    )
  }

  private async createSubscription(type: string, version: string): Promise<void> {
    // userId is the account the access token belongs to — bot or broadcaster
    const userId = this.config.userId ?? this.config.broadcasterId

    const condition: Record<string, string> = {
      broadcaster_user_id: this.config.broadcasterId,
    }

    // channel.chat.message and channel.chat.message_delete both require
    // user_id — the chat client acting on behalf of this user
    if (type === 'channel.chat.message' || type === 'channel.chat.message_delete') {
      condition['user_id'] = userId
    }

    // channel.follow requires a moderator_user_id in addition to broadcaster
    if (type === 'channel.follow') {
      condition['moderator_user_id'] = userId
    }

    const doRequest = (): Promise<Response> => fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        'Client-Id': this.config.clientId,
        Authorization: `Bearer ${this.getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type,
        version,
        condition,
        transport: {
          method: 'websocket',
          session_id: this.sessionId,
        },
      }),
    })

    let res = await doRequest()
    if (res.status === 401 && this.on401) {
      try {
        await this.on401()
        res = await doRequest()
      } catch {
        // fall through with the 401
      }
    }

    if (!res.ok && res.status !== 409) {
      // 409 = already subscribed, fine
      throw new Error(`EventSub subscription failed for ${type}: ${res.status} ${res.statusText}`)
    }
  }

  private resetKeepalive(): void {
    this.clearKeepalive()
    this.keepaliveTimer = setTimeout(() => {
      this.ws?.close()
    }, 25_000)
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }
}
