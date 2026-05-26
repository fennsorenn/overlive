import type { ResolvedEmote, EmotePlatform, MessageToken } from '@overlive/core'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  emotes: Map<string, ResolvedEmote>
  fetchedAt: number
}

type EmoteMap = Map<string, ResolvedEmote>

/**
 * Fetches and caches emotes from all configured platforms,
 * then resolves chat message text into typed tokens.
 *
 * Usage:
 *   const resolver = new EmoteResolver({ channelId: '...', twitchClientId: '...' })
 *   await resolver.warmup()
 *   const tokens = await resolver.resolve(messageText, twitchEmoteData)
 */
export class EmoteResolver {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly platforms: Set<EmotePlatform>

  constructor(
    private readonly config: {
      /** Twitch broadcaster user ID */
      channelId: string
      /** Twitch Client-ID for emote API */
      twitchClientId?: string
      twitchAccessToken?: string
      /** Which emote platforms to resolve. Defaults to all. */
      platforms?: EmotePlatform[]
    },
  ) {
    this.platforms = new Set(config.platforms ?? ['twitch', '7tv', 'bttv', 'ffz'])
  }

  /**
   * Pre-fetch all emote sets. Call this after connecting to warm the cache.
   */
  async warmup(): Promise<void> {
    await this.getEmotes()
  }

  /**
   * Resolve a message string into typed tokens, injecting emote objects
   * where emote names are found in the text.
   *
   * @param text      Raw message text
   * @param twitchEmoteRanges  Optional raw Twitch emote positions from IRC
   *                           (format: "id:start-end,start-end/id:...")
   */
  async resolve(
    text: string,
    twitchEmoteRanges?: string,
  ): Promise<MessageToken[]> {
    const emotes = await this.getEmotes()

    // Build a set of Twitch emote positions from IRC metadata if available
    const twitchPositions = parseTwitchEmoteRanges(twitchEmoteRanges ?? '')

    const tokens: MessageToken[] = []
    const words = text.split(' ')
    let charPos = 0

    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? ''
      const wordEnd = charPos + word.length

      // Check if this word is at a known Twitch emote position
      const twitchEmoteId = twitchPositions.get(charPos)
      if (twitchEmoteId) {
        const twitchEmote = emotes.get(`twitch:${twitchEmoteId}`) ?? emotes.get(`twitch:name:${word}`)
        if (twitchEmote) {
          tokens.push({ type: 'emote', emote: twitchEmote })
          charPos = wordEnd + 1
          continue
        }
      }

      // Check by name across all platforms
      const emote = emotes.get(word)
      if (emote) {
        tokens.push({ type: 'emote', emote })
      } else if (word.startsWith('@')) {
        tokens.push({ type: 'mention', username: word.slice(1) })
      } else if (word.startsWith('http://') || word.startsWith('https://')) {
        tokens.push({ type: 'url', href: word, display: word })
      } else {
        // Merge consecutive text tokens
        const last = tokens[tokens.length - 1]
        if (last?.type === 'text') {
          last.value += ` ${word}`
        } else {
          tokens.push({ type: 'text', value: word })
        }
      }

      charPos = wordEnd + 1
    }

    return tokens
  }

  // ─── Emote fetching ───────────────────────────────────────────────────────

  private async getEmotes(): Promise<EmoteMap> {
    const cacheKey = this.config.channelId
    const cached = this.cache.get(cacheKey)

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.emotes
    }

    const results = await Promise.allSettled([
      this.platforms.has('twitch') ? this.fetchTwitch() : Promise.resolve<ResolvedEmote[]>([]),
      this.platforms.has('7tv')   ? this.fetch7TV()   : Promise.resolve<ResolvedEmote[]>([]),
      this.platforms.has('bttv')  ? this.fetchBTTV()  : Promise.resolve<ResolvedEmote[]>([]),
      this.platforms.has('ffz')   ? this.fetchFFZ()   : Promise.resolve<ResolvedEmote[]>([]),
    ])

    const emoteMap: EmoteMap = new Map()

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const emote of result.value) {
          // Primary key: emote name (for text matching)
          emoteMap.set(emote.name, emote)
          // Secondary key: platform:id (for IRC position matching)
          emoteMap.set(`${emote.platform}:${emote.id}`, emote)
        }
      }
    }

    this.cache.set(cacheKey, { emotes: emoteMap, fetchedAt: Date.now() })
    return emoteMap
  }

  private async fetchTwitch(): Promise<ResolvedEmote[]> {
    if (!this.config.twitchClientId || !this.config.twitchAccessToken) return []

    const res = await fetch(
      `https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${this.config.channelId}`,
      {
        headers: {
          'Client-Id': this.config.twitchClientId,
          Authorization: `Bearer ${this.config.twitchAccessToken}`,
        },
      },
    )

    if (!res.ok) return []
    const data = await res.json() as { data: unknown[] }

    return data.data.map((e) => {
      const emote = e as Record<string, unknown>
      const images = (emote['images'] ?? {}) as Record<string, string>
      return {
        id: String(emote['id'] ?? ''),
        name: String(emote['name'] ?? ''),
        platform: 'twitch' as EmotePlatform,
        animated: String(emote['format'] ?? '').includes('animated'),
        urls: {
          x1: images['url_1x'] ?? '',
          x2: images['url_2x'] ?? '',
          x4: images['url_4x'] ?? '',
        },
      }
    })
  }

  private async fetch7TV(): Promise<ResolvedEmote[]> {
    const res = await fetch(
      `https://7tv.io/v3/users/twitch/${this.config.channelId}`,
    )
    if (!res.ok) return []

    const data = await res.json() as Record<string, unknown>
    const emoteSet = (data['emote_set'] ?? {}) as Record<string, unknown>
    const emotes = (emoteSet['emotes'] ?? []) as unknown[]

    return emotes.map((e) => {
      const emote = e as Record<string, unknown>
      const emoteData = (emote['data'] ?? {}) as Record<string, unknown>
      const host = (emoteData['host'] ?? {}) as Record<string, unknown>
      const hostUrl = String(host['url'] ?? '')
      const files = (host['files'] ?? []) as Array<Record<string, unknown>>

      const bySize = (size: string) => {
        const f = files.find((f) => f['name'] === `${size}.webp`)
        return f ? `https:${hostUrl}/${f['name']}` : ''
      }

      return {
        id: String(emote['id'] ?? ''),
        name: String(emote['name'] ?? ''),
        platform: '7tv' as EmotePlatform,
        animated: Boolean(emoteData['animated']),
        urls: { x1: bySize('1x'), x2: bySize('2x'), x4: bySize('4x') },
      }
    })
  }

  private async fetchBTTV(): Promise<ResolvedEmote[]> {
    const res = await fetch(
      `https://api.betterttv.net/3/cached/users/twitch/${this.config.channelId}`,
    )
    if (!res.ok) return []

    const data = await res.json() as Record<string, unknown>
    const channelEmotes = (data['channelEmotes'] ?? []) as unknown[]
    const sharedEmotes = (data['sharedEmotes'] ?? []) as unknown[]
    const all = [...channelEmotes, ...sharedEmotes]

    return all.map((e) => {
      const emote = e as Record<string, unknown>
      const id = String(emote['id'] ?? '')
      return {
        id,
        name: String(emote['code'] ?? ''),
        platform: 'bttv' as EmotePlatform,
        animated: String(emote['imageType'] ?? '') === 'gif',
        urls: {
          x1: `https://cdn.betterttv.net/emote/${id}/1x`,
          x2: `https://cdn.betterttv.net/emote/${id}/2x`,
          x4: `https://cdn.betterttv.net/emote/${id}/3x`,
        },
      }
    })
  }

  private async fetchFFZ(): Promise<ResolvedEmote[]> {
    const res = await fetch(
      `https://api.frankerfacez.com/v1/room/id/${this.config.channelId}`,
    )
    if (!res.ok) return []

    const data = await res.json() as Record<string, unknown>
    const sets = (data['sets'] ?? {}) as Record<string, unknown>
    const emotes: ResolvedEmote[] = []

    for (const set of Object.values(sets)) {
      const setData = set as Record<string, unknown>
      const setEmotes = (setData['emoticons'] ?? []) as unknown[]

      for (const e of setEmotes) {
        const emote = e as Record<string, unknown>
        const urls = (emote['urls'] ?? {}) as Record<string, string>
        emotes.push({
          id: String(emote['id'] ?? ''),
          name: String(emote['name'] ?? ''),
          platform: 'ffz' as EmotePlatform,
          animated: false, // FFZ doesn't support animated emotes
          urls: {
            x1: urls['1'] ? `https:${urls['1']}` : '',
            x2: urls['2'] ? `https:${urls['2']}` : '',
            x4: urls['4'] ? `https:${urls['4']}` : '',
          },
        })
      }
    }

    return emotes
  }

  /** Invalidate the cache — call this if emotes are updated mid-stream */
  invalidate(): void {
    this.cache.delete(this.config.channelId)
  }
}

// ─── Twitch IRC emote range parser ────────────────────────────────────────────

/**
 * Parses Twitch IRC emote metadata into a map of startPosition → emoteId.
 * Format: "emoteId:start-end,start-end/emoteId:start-end"
 */
function parseTwitchEmoteRanges(raw: string): Map<number, string> {
  const positions = new Map<number, string>()
  if (!raw) return positions

  for (const part of raw.split('/')) {
    const [id, ranges] = part.split(':')
    if (!id || !ranges) continue
    for (const range of ranges.split(',')) {
      const [start] = range.split('-')
      if (start !== undefined) positions.set(Number(start), id)
    }
  }

  return positions
}
