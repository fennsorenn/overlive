import type { Platform } from '../events/types.js'
import type { AdapterRegistry } from '../adapter/AdapterRegistry.js'
import { isRestCapable } from '../adapter/types.js'

export interface TopDonor {
  username: string
  displayName: string
  amount: number
  currency: string
  platform: Platform
}

export interface ClipResult {
  id: string
  title: string
  url: string
  thumbnailUrl: string
  viewCount: number
  createdAt: Date
  duration: number
  platform: Platform
}

export interface StreamInfo {
  title: string
  category?: string
  viewerCount?: number
  startedAt?: Date
  platform: Platform
}

export interface ChattersResult {
  total: number
  platform: Platform
  usernames: string[]
}

/**
 * Unified REST client exposed as `kit.rest`.
 *
 * When no platform is specified (or multiple are), results from all capable
 * adapters are fetched in parallel and merged/sorted before returning.
 *
 * When a single platform is specified, only that adapter is called.
 */
export class UnifiedRestClient {
  constructor(private readonly registry: AdapterRegistry) {}

  // ─── Donations / tips ──────────────────────────────────────────────────────

  async getTopDonors(options: {
    platform?: Platform | Platform[]
    limit?: number
    period?: 'session' | 'week' | 'month' | 'alltime'
  } = {}): Promise<TopDonor[]> {
    const clients = this.getRestClients(options.platform)
    const results = await Promise.allSettled(
      clients.map(async (c) => {
        if (!('getTopDonors' in c)) return []
        return (c as any).getTopDonors(options)
      }),
    )
    const merged = results
      .filter((r): r is PromiseFulfilledResult<TopDonor[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value)
      .sort((a, b) => b.amount - a.amount)

    return options.limit ? merged.slice(0, options.limit) : merged
  }

  // ─── Stream info ───────────────────────────────────────────────────────────

  async getStreamInfo(options: {
    platform?: Platform | Platform[]
    channel?: string
  } = {}): Promise<StreamInfo[]> {
    const clients = this.getRestClients(options.platform)
    const results = await Promise.allSettled(
      clients.map(async (c) => {
        if (!('getStreamInfo' in c)) return null
        return (c as any).getStreamInfo(options)
      }),
    )
    return results
      .filter((r): r is PromiseFulfilledResult<StreamInfo | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is StreamInfo => v !== null)
  }

  // ─── Clips ─────────────────────────────────────────────────────────────────

  async getClips(options: {
    platform?: Platform | Platform[]
    limit?: number
    period?: 'day' | 'week' | 'month' | 'alltime'
  } = {}): Promise<ClipResult[]> {
    const clients = this.getRestClients(options.platform)
    const results = await Promise.allSettled(
      clients.map(async (c) => {
        if (!('getClips' in c)) return []
        return (c as any).getClips(options)
      }),
    )
    const merged = results
      .filter((r): r is PromiseFulfilledResult<ClipResult[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value)
      .sort((a, b) => b.viewCount - a.viewCount)

    return options.limit ? merged.slice(0, options.limit) : merged
  }

  // ─── Chatters ──────────────────────────────────────────────────────────────

  async getChatters(options: {
    platform?: Platform | Platform[]
  } = {}): Promise<ChattersResult[]> {
    const clients = this.getRestClients(options.platform)
    const results = await Promise.allSettled(
      clients.map(async (c) => {
        if (!('getChatters' in c)) return null
        return (c as any).getChatters(options)
      }),
    )
    return results
      .filter((r): r is PromiseFulfilledResult<ChattersResult | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is ChattersResult => v !== null)
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private getRestClients(platform?: Platform | Platform[]) {
    const adapters = platform
      ? (Array.isArray(platform) ? platform : [platform])
          .map((p) => this.registry.get(p))
          .filter((a): a is NonNullable<typeof a> => a != null)
      : this.registry.getAll()

    return adapters
      .filter(isRestCapable)
      .map((a) => a.rest)
  }

  /**
   * Access a platform-specific REST client directly for calls that have
   * no cross-platform equivalent.
   *
   * @example
   * kit.rest.platform('twitch').getChannelRewards()
   */
  platform<T extends object = object>(platform: Platform): T {
    const adapter = this.registry.get(platform)
    if (!adapter) {
      throw new Error(`No adapter registered for platform "${platform}"`)
    }
    if (!isRestCapable(adapter)) {
      throw new Error(`Adapter for platform "${platform}" does not support REST`)
    }
    return adapter.rest as unknown as T
  }
}
