import type { AdapterRestClient, Platform, TopDonor } from '@overlive/core'

const SE_API = 'https://api.streamelements.com/kappa/v2'

export class SERestClient implements AdapterRestClient {
  readonly platform: Platform = 'streamelements'

  constructor(
    private readonly jwt: string,
    private readonly channelId: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${SE_API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`SE API error: ${res.status} ${res.statusText} (${path})`)
    }

    return res.json() as Promise<T>
  }

  // ─── Top donors ───────────────────────────────────────────────────────────

  async getTopDonors(options: {
    limit?: number
    period?: 'session' | 'week' | 'month' | 'alltime'
  } = {}): Promise<TopDonor[]> {
    const period = options.period ?? 'alltime'
    const limit = options.limit ?? 10

    const data = await this.get<{ docs: unknown[] }>(
      `/tips/${this.channelId}/leaderboard?limit=${limit}&period=${period}`,
    )

    return data.docs.map((d) => {
      const doc = d as Record<string, unknown>
      const user = (doc['user'] ?? {}) as Record<string, unknown>
      return {
        username: String(user['username'] ?? ''),
        displayName: String(user['displayName'] ?? user['username'] ?? ''),
        amount: Number(doc['amount'] ?? 0),
        currency: String(doc['currency'] ?? 'USD'),
        platform: 'streamelements' as Platform,
      }
    })
  }

  // ─── Session data ─────────────────────────────────────────────────────────

  async getSessionData(): Promise<Record<string, unknown>> {
    return this.get(`/sessions/${this.channelId}`)
  }

  // ─── Points / loyalty ─────────────────────────────────────────────────────

  async getUserPoints(username: string): Promise<{ points: number; rank: number } | null> {
    try {
      const data = await this.get<Record<string, unknown>>(
        `/points/${this.channelId}/${username}`,
      )
      return {
        points: Number(data['points'] ?? 0),
        rank: Number(data['rank'] ?? 0),
      }
    } catch {
      return null
    }
  }

  async getTopPoints(limit = 10): Promise<Array<{ username: string; points: number; rank: number }>> {
    const data = await this.get<{ users: unknown[] }>(
      `/points/${this.channelId}/top?limit=${limit}`,
    )

    return data.users.map((u, i) => {
      const user = u as Record<string, unknown>
      return {
        username: String(user['username'] ?? ''),
        points: Number(user['points'] ?? 0),
        rank: i + 1,
      }
    })
  }

  // ─── Store / redemptions ──────────────────────────────────────────────────

  async getStoreItems(): Promise<Array<{ id: string; name: string; cost: number; enabled: boolean }>> {
    const data = await this.get<{ items: unknown[] }>(`/store/${this.channelId}/items`)

    return data.items.map((item) => {
      const i = item as Record<string, unknown>
      return {
        id: String(i['_id'] ?? ''),
        name: String(i['name'] ?? ''),
        cost: Number(i['cost'] ?? 0),
        enabled: Boolean(i['enabled']),
      }
    })
  }
}
