import type { AdapterRestClient, Platform, ClipResult, StreamInfo, ChattersResult } from '@overlive/core'

const HELIX = 'https://api.twitch.tv/helix'

/**
 * Hook the adapter installs so REST 401s trigger a token refresh + retry.
 * Returns the new access token on success; throws on permanent failure.
 */
export type On401Hook = () => Promise<string>

export class TwitchRestClient implements AdapterRestClient {
  readonly platform: Platform = 'twitch'

  /**
   * Access token getter — invoked on every request so refresh-in-flight
   * updates take effect without rebuilding the client. The adapter holds
   * the canonical token and rebinds via setAccessToken().
   */
  private getAccessToken: () => string
  private on401: On401Hook | null = null

  constructor(
    private readonly clientId: string,
    accessToken: string,
    private readonly broadcasterId: string,
  ) {
    let token = accessToken
    this.getAccessToken = () => token
    // Internal setter so the adapter can rotate tokens after a refresh.
    this.setAccessToken = (t: string) => { token = t }
  }

  /**
   * Replace the access token used for subsequent requests. Called by the
   * TwitchAdapter after a successful refresh.
   */
  readonly setAccessToken: (token: string) => void

  /**
   * Install the 401-refresh hook. The adapter calls this during construction.
   */
  _setOn401(hook: On401Hook | null): void {
    this.on401 = hook
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${HELIX}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const doFetch = (): Promise<Response> => fetch(url, {
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.getAccessToken()}`,
      },
    })

    let res = await doFetch()
    if (res.status === 401 && this.on401) {
      // Try to refresh and retry once.
      try {
        await this.on401()
        res = await doFetch()
      } catch {
        // Fall through with the original 401 response.
      }
    }

    if (!res.ok) {
      throw new Error(`Twitch API error: ${res.status} ${res.statusText} (${path})`)
    }

    return res.json() as Promise<T>
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(`${HELIX}${path}`)

    const doFetch = (): Promise<Response> => fetch(url, {
      method: 'POST',
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let res = await doFetch()
    if (res.status === 401 && this.on401) {
      // Try to refresh and retry once.
      try {
        await this.on401()
        res = await doFetch()
      } catch {
        // Fall through with the original 401 response.
      }
    }

    if (!res.ok) {
      throw new Error(`Twitch API error: ${res.status} ${res.statusText} (${path})`)
    }

    // Some Helix POSTs reply 204 with no body; tolerate an empty response.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // ─── Send chat ────────────────────────────────────────────────────────────

  /**
   * Post a chat message to the broadcaster's channel as the broadcaster's own
   * account (`sender_id === broadcaster_id`). Requires the `user:write:chat`
   * scope on the access token. Helix: POST /helix/chat/messages.
   */
  async sendChatMessage(message: string): Promise<void> {
    await this.post('/chat/messages', {
      broadcaster_id: this.broadcasterId,
      sender_id: this.broadcasterId,
      message,
    })
  }

  // ─── Clips ────────────────────────────────────────────────────────────────

  async getClips(options: {
    limit?: number
    period?: 'day' | 'week' | 'month' | 'alltime'
  } = {}): Promise<ClipResult[]> {
    const params: Record<string, string> = {
      broadcaster_id: this.broadcasterId,
      first: String(Math.min(options.limit ?? 20, 100)),
    }

    if (options.period && options.period !== 'alltime') {
      const now = new Date()
      const start = new Date(now)
      if (options.period === 'day') start.setDate(now.getDate() - 1)
      if (options.period === 'week') start.setDate(now.getDate() - 7)
      if (options.period === 'month') start.setMonth(now.getMonth() - 1)
      params['started_at'] = start.toISOString()
    }

    const data = await this.get<{ data: unknown[] }>('/clips', params)

    return data.data.map((c) => {
      const clip = c as Record<string, unknown>
      return {
        id: String(clip['id'] ?? ''),
        title: String(clip['title'] ?? ''),
        url: String(clip['url'] ?? ''),
        thumbnailUrl: String(clip['thumbnail_url'] ?? ''),
        viewCount: Number(clip['view_count'] ?? 0),
        createdAt: new Date(String(clip['created_at'] ?? '')),
        duration: Number(clip['duration'] ?? 0),
        platform: 'twitch' as Platform,
      }
    })
  }

  // ─── Stream info ──────────────────────────────────────────────────────────

  async getStreamInfo(): Promise<StreamInfo | null> {
    const data = await this.get<{ data: unknown[] }>('/streams', {
      user_id: this.broadcasterId,
    })

    const stream = data.data[0] as Record<string, unknown> | undefined
    if (!stream) return null

    const category = String(stream['game_name'] ?? '')
    return {
      title: String(stream['title'] ?? ''),
      ...(category ? { category } : {}),
      viewerCount: Number(stream['viewer_count'] ?? 0),
      startedAt: new Date(String(stream['started_at'] ?? '')),
      platform: 'twitch',
    }
  }

  // ─── Chatters ─────────────────────────────────────────────────────────────

  async getChatters(): Promise<ChattersResult> {
    const data = await this.get<{ data: unknown[]; total: number }>('/chat/chatters', {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
    })

    return {
      total: data.total,
      platform: 'twitch',
      usernames: data.data.map((c) => String((c as Record<string, unknown>)['user_login'] ?? '')),
    }
  }

  // ─── Channel rewards ──────────────────────────────────────────────────────

  async getChannelRewards(): Promise<Array<{ id: string; title: string; cost: number; isEnabled: boolean }>> {
    const data = await this.get<{ data: unknown[] }>('/channel_points/custom_rewards', {
      broadcaster_id: this.broadcasterId,
    })

    return data.data.map((r) => {
      const reward = r as Record<string, unknown>
      return {
        id: String(reward['id'] ?? ''),
        title: String(reward['title'] ?? ''),
        cost: Number(reward['cost'] ?? 0),
        isEnabled: Boolean(reward['is_enabled']),
      }
    })
  }

  // ─── User info ────────────────────────────────────────────────────────────

  async getUser(login: string): Promise<{ id: string; login: string; displayName: string } | null> {
    const data = await this.get<{ data: unknown[] }>('/users', { login })
    const user = data.data[0] as Record<string, unknown> | undefined
    if (!user) return null
    return {
      id: String(user['id'] ?? ''),
      login: String(user['login'] ?? ''),
      displayName: String(user['display_name'] ?? ''),
    }
  }

  async getUserById(id: string): Promise<{ id: string; login: string; displayName: string } | null> {
    const data = await this.get<{ data: unknown[] }>('/users', { id })
    const user = data.data[0] as Record<string, unknown> | undefined
    if (!user) return null
    return {
      id: String(user['id'] ?? ''),
      login: String(user['login'] ?? ''),
      displayName: String(user['display_name'] ?? ''),
    }
  }

  // ─── Moderators ───────────────────────────────────────────────────────────

  async getModerators(): Promise<Array<{ userId: string; username: string; displayName: string }>> {
    const data = await this.get<{ data: unknown[] }>('/moderation/moderators', {
      broadcaster_id: this.broadcasterId,
    })

    return data.data.map((m) => {
      const mod = m as Record<string, unknown>
      return {
        userId: String(mod['user_id'] ?? ''),
        username: String(mod['user_login'] ?? ''),
        displayName: String(mod['user_name'] ?? ''),
      }
    })
  }
}
