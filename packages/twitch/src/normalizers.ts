import type {
  RedemptionEvent,
  SubscriptionEvent,
  GiftBombEvent,
  RaidEvent,
  FollowEvent,
  BanEvent,
  DeleteMessageEvent,
  AdStartEvent,
  StreamOnlineEvent,
  StreamOfflineEvent,
  SubscriptionTier,
} from '@overlive/core'

// Normalizers produce events *before* the kit stamps `sourceInstanceId`,
// so each return type omits that field.
type Emitted<E> = Omit<E, 'sourceInstanceId'>

const PLATFORM = 'twitch' as const

const randomUUID = (): string => globalThis.crypto.randomUUID()

/**
 * Build a partial object for an optional field, omitted when the value is
 * falsy. Used to satisfy `exactOptionalPropertyTypes: true` — assigning
 * `undefined` to an optional property is not allowed, but omitting the key
 * is.
 */
function opt<K extends string, V>(key: K, value: V | undefined | null | '' | 0): { [P in K]?: V } {
  return value ? ({ [key]: value } as { [P in K]?: V }) : ({} as { [P in K]?: V })
}

function tier(raw: string): SubscriptionTier {
  if (raw === '1000') return 'tier1'
  if (raw === '2000') return 'tier2'
  if (raw === '3000') return 'tier3'
  if (raw === 'Prime') return 'prime'
  return 'unknown'
}

// ─── Cheer (bits) ────────────────────────────────────────────────────────────

export function normalizeCheer(raw: unknown, channel: string): Emitted<RedemptionEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'redemption',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
      currency: {
        kind: 'bits',
        amount: Number(e['bits'] ?? 0),
      },
      ...opt('message', String(e['message'] ?? '')),
    },
  }
}

// ─── Channel point redemption ────────────────────────────────────────────────

export function normalizeRedemption(raw: unknown, channel: string): Emitted<RedemptionEvent> {
  const e = raw as Record<string, unknown>
  const reward = (e['reward'] ?? {}) as Record<string, unknown>
  return {
    id: String(e['id'] ?? randomUUID()),
    type: 'redemption',
    platform: PLATFORM,
    channel,
    timestamp: new Date(String(e['redeemed_at'] ?? Date.now())),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
      currency: {
        kind: 'channel_points',
        amount: Number(reward['cost'] ?? 0),
        rewardTitle: String(reward['title'] ?? ''),
        rewardId: String(reward['id'] ?? ''),
        requiresApproval: Boolean(reward['should_redemptions_skip_request_queue'] === false),
      },
      ...opt('message', String((e['user_input'] as string) ?? '')),
    },
  }
}

// ─── New subscription ────────────────────────────────────────────────────────

export function normalizeSubscription(raw: unknown, channel: string): Emitted<SubscriptionEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'subscription',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
      tier: tier(String(e['tier'] ?? '')),
      months: 1,
      isFirst: !e['is_gift'],
      isResub: false,
      isGift: Boolean(e['is_gift']),
    },
  }
}

// ─── Resub message ────────────────────────────────────────────────────────────

export function normalizeResubMessage(raw: unknown, channel: string): Emitted<SubscriptionEvent> {
  const e = raw as Record<string, unknown>
  const msg = (e['message'] ?? {}) as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'subscription',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
      tier: tier(String(e['tier'] ?? '')),
      months: Number(e['cumulative_months'] ?? 1),
      ...opt('streak', Number(e['streak_months'] ?? 0)),
      isFirst: false,
      isResub: true,
      isGift: false,
      ...opt('message', String(msg['text'] ?? '')),
    },
  }
}

// ─── Gift bomb ────────────────────────────────────────────────────────────────

export function normalizeGiftBomb(raw: unknown, channel: string): Emitted<GiftBombEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'gift_bomb',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      gifter: {
        username: String(e['user_login'] ?? 'anonymous'),
        displayName: String(e['user_name'] ?? 'anonymous'),
        ...opt('userId', String(e['user_id'] ?? '')),
      },
      count: Number(e['total'] ?? 1),
      tier: tier(String(e['tier'] ?? '')),
      ...opt('totalGifts', Number(e['cumulative_total'] ?? 0)),
      anonymous: !e['user_login'],
    },
  }
}

// ─── Raid ────────────────────────────────────────────────────────────────────

export function normalizeRaid(raw: unknown, channel: string): Emitted<RaidEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'raid',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      from: {
        username: String(e['from_broadcaster_user_login'] ?? ''),
        displayName: String(e['from_broadcaster_user_name'] ?? ''),
        ...opt('userId', String(e['from_broadcaster_user_id'] ?? '')),
      },
      viewerCount: Number(e['viewers'] ?? 0),
    },
  }
}

// ─── Follow ───────────────────────────────────────────────────────────────────

export function normalizeFollow(raw: unknown, channel: string): Emitted<FollowEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'follow',
    platform: PLATFORM,
    channel,
    timestamp: new Date(String(e['followed_at'] ?? Date.now())),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
    },
  }
}

// ─── Ban / timeout ───────────────────────────────────────────────────────────

export function normalizeBan(raw: unknown, channel: string): Emitted<BanEvent> {
  const e = raw as Record<string, unknown>
  const isPermanent = !e['ends_at']
  const endsAt = e['ends_at'] ? new Date(String(e['ends_at'])) : null
  const timeoutSeconds = endsAt
    ? Math.round((endsAt.getTime() - Date.now()) / 1000)
    : undefined

  const moderator = e['moderator_user_login']
    ? {
        username: String(e['moderator_user_login']),
        ...opt('userId', String(e['moderator_user_id'] ?? '')),
      }
    : undefined

  return {
    id: randomUUID(),
    type: 'ban',
    platform: PLATFORM,
    channel,
    timestamp: new Date(String(e['banned_at'] ?? Date.now())),
    raw,
    data: {
      username: String(e['user_login'] ?? ''),
      displayName: String(e['user_name'] ?? ''),
      ...opt('userId', String(e['user_id'] ?? '')),
      ...opt('moderator', moderator),
      ...opt('reason', String(e['reason'] ?? '')),
      ...(isPermanent ? {} : opt('timeoutSeconds', timeoutSeconds)),
      isPermanent,
    },
  }
}

// ─── Deleted message ──────────────────────────────────────────────────────────

export function normalizeDeletedMessage(raw: unknown, channel: string): Emitted<DeleteMessageEvent> {
  const e = raw as Record<string, unknown>
  const moderator = e['moderator_user_login']
    ? {
        username: String(e['moderator_user_login']),
        ...opt('userId', String(e['moderator_user_id'] ?? '')),
      }
    : undefined

  return {
    id: randomUUID(),
    type: 'chat.delete',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      messageId: String(e['message_id'] ?? ''),
      username: String(e['target_user_login'] ?? ''),
      ...opt('userId', String(e['target_user_id'] ?? '')),
      ...opt('moderator', moderator),
    },
  }
}

// ─── Ad break ────────────────────────────────────────────────────────────────

export function normalizeAdBreak(raw: unknown, channel: string): Emitted<AdStartEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'ad.start',
    platform: PLATFORM,
    channel,
    timestamp: new Date(String(e['started_at'] ?? Date.now())),
    raw,
    data: {
      durationSeconds: Number(e['duration_seconds'] ?? 0),
      isAutomatic: Boolean(e['is_automatic']),
    },
  }
}

// ─── Stream online / offline ──────────────────────────────────────────────────

export function normalizeStreamOnline(raw: unknown, channel: string): Emitted<StreamOnlineEvent> {
  const e = raw as Record<string, unknown>
  return {
    id: randomUUID(),
    type: 'stream.online',
    platform: PLATFORM,
    channel,
    timestamp: new Date(String(e['started_at'] ?? Date.now())),
    raw,
    data: {
      title: '',      // EventSub stream.online doesn't include title — fetch via REST
    },
  }
}

export function normalizeStreamOffline(_raw: unknown, channel: string): Emitted<StreamOfflineEvent> {
  return {
    id: randomUUID(),
    type: 'stream.offline',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw: _raw,
    data: {},
  }
}

// ─── Chat message (EventSub channel.chat.message) ─────────────────────────────

import type { ChatMessageEvent, ChatCommandEvent, MessageToken, ResolvedEmote } from '@overlive/core'

export interface ChatNormalizerOptions {
  commandPrefixes: string[]
  channel: string
}

/**
 * EventSub channel.chat.message payload fragment shape.
 */
interface EventSubFragment {
  type: 'text' | 'cheermote' | 'emote' | 'mention'
  text: string
  cheermote?: {
    prefix: string
    bits: number
    tier: number
  }
  emote?: {
    id: string
    emote_set_id: string
    owner_id: string
    format: string[]
  }
  mention?: {
    user_id: string
    user_name: string
    user_login: string
  }
}

/**
 * Normalizes an EventSub channel.chat.message event into a ChatMessageEvent
 * or ChatCommandEvent. No IRC parsing needed — fragments are already structured.
 */
export function normalizeChatMessage(
  raw: unknown,
  options: ChatNormalizerOptions,
): Emitted<ChatMessageEvent> | Emitted<ChatCommandEvent> | null {
  const e = raw as Record<string, unknown>
  const msg = (e['message'] ?? {}) as Record<string, unknown>
  const fragments = (msg['fragments'] ?? []) as EventSubFragment[]
  const badges = ((e['badges'] ?? []) as Array<Record<string, unknown>>).map((b) => ({
    id: String(b['set_id'] ?? ''),
    version: String(b['id'] ?? ''),
  }))

  const messageId = String(e['message_id'] ?? randomUUID())
  const username = String(e['chatter_user_login'] ?? '')
  const displayName = String(e['chatter_user_name'] ?? username)
  const userId = String(e['chatter_user_id'] ?? '')
  const text = String(msg['text'] ?? '')
  const color = String(e['color'] ?? '')
  const isAction = e['message_type'] === 'action'
  const isHighlighted = e['message_type'] === 'channel_points_highlighted'

  // Cheer amount — sum all cheermote fragments
  const cheerAmount = fragments
    .filter((f) => f.type === 'cheermote' && f.cheermote)
    .reduce((sum, f) => sum + (f.cheermote?.bits ?? 0), 0)

  // Badge role checks
  const badgeIds = new Set(badges.map((b) => b.id))
  const isBroadcaster = badgeIds.has('broadcaster')
  const isMod = badgeIds.has('moderator') || isBroadcaster
  const isSub = badgeIds.has('subscriber') || badgeIds.has('founder')

  // Build tokens from fragments — these are already parsed by Twitch,
  // so no manual emote range parsing needed. Emote URLs are resolved
  // by the emotes package separately; here we emit unresolved emote tokens
  // with the id so the resolver can hydrate them.
  const tokens: MessageToken[] = fragments.map((fragment): MessageToken => {
    switch (fragment.type) {
      case 'emote': {
        if (!fragment.emote) return { type: 'text', value: fragment.text }
        const id = fragment.emote.id
        const animated = fragment.emote.format.includes('animated')
        const fmt = animated ? 'animated' : 'static'
        const emote: ResolvedEmote = {
          id,
          name: fragment.text,
          platform: 'twitch',
          animated,
          urls: {
            x1: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${fmt}/light/1.0`,
            x2: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${fmt}/light/2.0`,
            x4: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${fmt}/light/3.0`,
          },
        }
        return { type: 'emote', emote }
      }
      case 'mention':
        return { type: 'mention', username: fragment.mention?.user_login ?? fragment.text.slice(1) }
      case 'cheermote':
        return { type: 'cheer', amount: fragment.cheermote?.bits ?? 0 }
      default:
        return { type: 'text', value: fragment.text }
    }
  })

  const timestamp = new Date(String(e['timestamp'] ?? Date.now()))

  // ─── Command detection ────────────────────────────────────────────────────

  for (const prefix of options.commandPrefixes) {
    if (text.startsWith(prefix) && text.length > prefix.length) {
      const withoutPrefix = text.slice(prefix.length)
      const parts = withoutPrefix.split(/\s+/)
      const command = parts[0]?.toLowerCase() ?? ''
      const args = parts.slice(1)

      if (command.length > 0) {
        return {
          id: messageId,
          type: 'chat.command',
          platform: PLATFORM,
          channel: options.channel,
          timestamp,
          raw,
          data: {
            messageId,
            username,
            displayName,
            ...opt('userId', userId),
            command,
            prefix,
            args,
            text,
            ...opt('color', color),
            badges,
            isMod,
            isSub,
            isBroadcaster,
          },
        } satisfies Emitted<ChatCommandEvent>
      }
    }
  }

  // ─── Regular message ──────────────────────────────────────────────────────

  return {
    id: messageId,
    type: 'chat.message',
    platform: PLATFORM,
    channel: options.channel,
    timestamp,
    raw,
    data: {
      messageId,
      username,
      displayName,
      ...opt('userId', userId),
      text,
      tokens,
      ...opt('color', color),
      badges,
      isMod,
      isSub,
      isBroadcaster,
      isAction,
      isHighlighted,
      ...opt('cheerAmount', cheerAmount),
    },
  } satisfies Emitted<ChatMessageEvent>
}

// ─── Chat message delete (EventSub channel.chat.message_delete) ───────────────

export function normalizeChatMessageDelete(raw: unknown, channel: string): Emitted<DeleteMessageEvent> {
  const e = raw as Record<string, unknown>
  const moderator = e['moderator_user_login']
    ? {
        username: String(e['moderator_user_login']),
        ...opt('userId', String(e['moderator_user_id'] ?? '')),
      }
    : undefined

  return {
    id: randomUUID(),
    type: 'chat.delete',
    platform: PLATFORM,
    channel,
    timestamp: new Date(),
    raw,
    data: {
      messageId: String(e['message_id'] ?? ''),
      username: String(e['target_user_login'] ?? ''),
      ...opt('userId', String(e['target_user_id'] ?? '')),
      ...opt('moderator', moderator),
    },
  }
}
