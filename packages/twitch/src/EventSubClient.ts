import type { TwitchAdapterConfig } from './config.js'

export type EventSubHandler = (subscriptionType: string, event: unknown) => void

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

  constructor(private readonly config: TwitchAdapterConfig) {}

  onEvent(handler: EventSubHandler): void {
    this.handler = handler
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

    await Promise.all(subscriptions.map((sub) => this.createSubscription(sub.type, sub.version)))
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

    const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        'Client-Id': this.config.clientId,
        Authorization: `Bearer ${this.config.accessToken}`,
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
