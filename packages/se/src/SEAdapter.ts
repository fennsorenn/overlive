const randomUUID = () => globalThis.crypto.randomUUID()
import type {
  RestCapableAdapter,
  AdapterEventHandler,
  ConnectionState,
  SuppressionMap,
  RedemptionEvent,
  SubscriptionEvent,
  RaidEvent,
  FollowEvent,
} from '@overlive/core'
import { SERestClient } from './SERestClient.js'

const PLATFORM = 'streamelements' as const
const SE_REALTIME = 'https://realtime.streamelements.com'

export interface SEAdapterConfig {
  /**
   * StreamElements JWT token.
   * Found at https://streamelements.com/dashboard/account/channels
   */
  jwt: string

  /**
   * Your StreamElements channel ID.
   */
  channelId: string
}

export class SEAdapter implements RestCapableAdapter {
  readonly platform = PLATFORM
  readonly displayName = 'StreamElements'

  /**
   * When Twitch is present, SE defers on all events it can't own exclusively.
   * Tips/donations are NOT in this list — SE owns those.
   */
  readonly suppressedBy: SuppressionMap = {
    subscription:  ['twitch'],
    gift_bomb:     ['twitch'],
    raid:          ['twitch'],
    follow:        ['twitch'],
    ban:           ['twitch'],
    'chat.message':  ['twitch'],
    'chat.command':  ['twitch'],
    'chat.delete':   ['twitch'],
    'ad.start':      ['twitch'],
    'ad.end':        ['twitch'],
    'stream.online':  ['twitch'],
    'stream.offline': ['twitch'],
  }

  private _state: ConnectionState = 'disconnected'
  private handler: AdapterEventHandler | null = null
  private stateHandler: ((state: ConnectionState) => void) | null = null
  private socket: unknown = null

  readonly rest: SERestClient

  constructor(private readonly config: SEAdapterConfig) {
    this.rest = new SERestClient(config.jwt, config.channelId)
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

    const { io } = await import('socket.io-client')

    const socket = io(SE_REALTIME, {
      transports: ['websocket'],
    })

    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('authenticate', {
          method: 'jwt',
          token: this.config.jwt,
        })
      })

      socket.on('authenticated', () => {
        this.setState('connected')
        resolve()
      })

      socket.on('unauthorized', (err: unknown) => {
        this.setState('error')
        reject(new Error(`SE authentication failed: ${String(err)}`))
      })

      socket.on('disconnect', () => {
        this.setState('disconnected')
      })

      socket.on('reconnecting', () => {
        this.setState('reconnecting')
      })

      socket.on('event', (data: unknown) => {
        this.dispatchSEEvent(data)
      })

      socket.on('event:test', (data: unknown) => {
        this.dispatchSEEvent(data)
      })

      socket.on('connect_error', (err: Error) => {
        this.setState('error')
        reject(err)
      })

      this.socket = socket
    })
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      ;(this.socket as { disconnect(): void }).disconnect()
      this.socket = null
    }
    this.setState('disconnected')
  }

  // ─── SE event dispatch ────────────────────────────────────────────────────

  private dispatchSEEvent(raw: unknown): void {
    if (!this.handler) return

    const data = raw as Record<string, unknown>
    const type = String(data['type'] ?? '')
    const channel = this.config.channelId

    try {
      switch (type) {
        case 'tip':
          this.handler(this.normalizeTip(data, channel))
          break
        case 'subscriber':
          this.handler(this.normalizeSub(data, channel))
          break
        case 'raid':
          this.handler(this.normalizeRaid(data, channel))
          break
        case 'follower':
          this.handler(this.normalizeFollow(data, channel))
          break
        case 'cheer':
          this.handler(this.normalizeCheer(data, channel))
          break
        // merch, redemptions etc. can be added as SE exposes them
      }
    } catch (e) {
      console.error(`[overlive:se] Error normalizing ${type}:`, e)
    }
  }

  // ─── Normalizers ──────────────────────────────────────────────────────────

  private normalizeTip(data: Record<string, unknown>, channel: string): RedemptionEvent {
    const e = (data['event'] ?? data) as Record<string, unknown>
    return {
      id: String(e['_id'] ?? randomUUID()),
      type: 'redemption',
      platform: PLATFORM,
      channel,
      timestamp: new Date(String(e['createdAt'] ?? Date.now())),
      raw: data,
      data: {
        username: String(e['username'] ?? ''),
        displayName: String(e['username'] ?? ''),
        currency: {
          kind: 'tip',
          amount: Number(e['amount'] ?? 0),
          currency: String(e['currency'] ?? 'USD'),
          formattedAmount: String(e['formattedAmount'] ?? `$${e['amount']}`),
        },
        ...(e['message'] ? { message: String(e['message']) } : {}),
      },
    }
  }

  private normalizeSub(data: Record<string, unknown>, channel: string): SubscriptionEvent {
    const e = (data['event'] ?? data) as Record<string, unknown>
    return {
      id: randomUUID(),
      type: 'subscription',
      platform: PLATFORM,
      channel,
      timestamp: new Date(),
      raw: data,
      data: {
        username: String(e['name'] ?? ''),
        displayName: String(e['displayName'] ?? e['name'] ?? ''),
        tier: 'tier1', // SE doesn't always expose tier
        months: Number(e['amount'] ?? 1),
        isFirst: false,
        isResub: Number(e['amount'] ?? 1) > 1,
        isGift: Boolean(e['gifted']),
        ...(e['sender'] ? { gifter: { username: String(e['sender']), displayName: String(e['sender']) } } : {}),
        ...(e['message'] ? { message: String(e['message']) } : {}),
      },
    }
  }

  private normalizeRaid(data: Record<string, unknown>, channel: string): RaidEvent {
    const e = (data['event'] ?? data) as Record<string, unknown>
    return {
      id: randomUUID(),
      type: 'raid',
      platform: PLATFORM,
      channel,
      timestamp: new Date(),
      raw: data,
      data: {
        from: {
          username: String(e['name'] ?? ''),
          displayName: String(e['displayName'] ?? e['name'] ?? ''),
        },
        viewerCount: Number(e['amount'] ?? 0),
      },
    }
  }

  private normalizeFollow(data: Record<string, unknown>, channel: string): FollowEvent {
    const e = (data['event'] ?? data) as Record<string, unknown>
    return {
      id: randomUUID(),
      type: 'follow',
      platform: PLATFORM,
      channel,
      timestamp: new Date(String(e['createdAt'] ?? Date.now())),
      raw: data,
      data: {
        username: String(e['name'] ?? ''),
        displayName: String(e['displayName'] ?? e['name'] ?? ''),
      },
    }
  }

  private normalizeCheer(data: Record<string, unknown>, channel: string): RedemptionEvent {
    const e = (data['event'] ?? data) as Record<string, unknown>
    return {
      id: randomUUID(),
      type: 'redemption',
      platform: PLATFORM,
      channel,
      timestamp: new Date(),
      raw: data,
      data: {
        username: String(e['name'] ?? ''),
        displayName: String(e['displayName'] ?? e['name'] ?? ''),
        currency: {
          kind: 'bits',
          amount: Number(e['amount'] ?? 0),
        },
        ...(e['message'] ? { message: String(e['message']) } : {}),
      },
    }
  }

  private setState(state: ConnectionState): void {
    this._state = state
    this.stateHandler?.(state)
  }
}
