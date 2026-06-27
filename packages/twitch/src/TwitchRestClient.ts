import type {
  AdapterRestClient,
  Platform,
  ClipResult,
  StreamInfo,
  ChattersResult,
  AnnouncementColor,
  ChannelUpdate,
  ChatSettingsUpdate,
  BanOptions,
  PollSpec,
  PredictionSpec,
  RedemptionStatus,
  PollEndStatus,
  PredictionEndStatus,
  AutoModAction,
} from '@overlive/core'

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

  /**
   * Single request path shared by every verb. Applies Client-Id + bearer auth,
   * does the one-shot 401 refresh-and-retry, throws on non-2xx, and tolerates
   * empty bodies (many Helix writes reply 204). `params` become the query
   * string; `body` is JSON-encoded for write verbs.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: { params?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${HELIX}${path}`)
    for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v)
    const hasBody = opts.body !== undefined

    const doFetch = (): Promise<Response> => fetch(url, {
      method,
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.getAccessToken()}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
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

    // Some Helix writes reply 204 with no body; tolerate an empty response.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>('GET', path, { params })
  }

  private post<T>(path: string, body?: unknown, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>('POST', path, { params, body })
  }

  private patch<T>(path: string, body?: unknown, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>('PATCH', path, { params, body })
  }

  private put<T>(path: string, body?: unknown, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>('PUT', path, { params, body })
  }

  private del<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return this.request<T>('DELETE', path, { params })
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

  // ─── Outbound actions ───────────────────────────────────────────────────────
  //
  // All moderation endpoints take `moderator_id`; the broadcaster is a moderator
  // of their own channel, so we pass `broadcasterId` for both. Scopes are
  // documented per method and aggregated in config.ts.

  /** POST /chat/announcements — `moderator:manage:announcements`. */
  async sendAnnouncement(message: string, color: AnnouncementColor = 'primary'): Promise<void> {
    await this.post('/chat/announcements', { message, color }, {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
    })
  }

  /** POST /chat/shoutouts — `moderator:manage:shoutouts`. */
  async sendShoutout(toBroadcasterId: string): Promise<void> {
    await this.post('/chat/shoutouts', undefined, {
      from_broadcaster_id: this.broadcasterId,
      to_broadcaster_id: toBroadcasterId,
      moderator_id: this.broadcasterId,
    })
  }

  /** PUT /chat/color — `user:manage:chat_color`. Named color or `#hex` (hex needs Turbo/Prime). */
  async updateChatColor(color: string): Promise<void> {
    await this.put('/chat/color', undefined, {
      user_id: this.broadcasterId,
      color,
    })
  }

  /** PATCH /channels — `channel:manage:broadcast`. Resolves `categoryName` to an id when needed. */
  async updateChannel(update: ChannelUpdate): Promise<void> {
    const body: Record<string, unknown> = {}
    if (update.title !== undefined) body['title'] = update.title
    if (update.language !== undefined) body['broadcaster_language'] = update.language
    if (update.tags !== undefined) body['tags'] = update.tags
    let categoryId = update.categoryId
    if (!categoryId && update.categoryName) {
      categoryId = (await this.getGameId(update.categoryName)) ?? undefined
    }
    if (categoryId !== undefined) body['game_id'] = categoryId
    if (Object.keys(body).length === 0) return
    await this.patch('/channels', body, { broadcaster_id: this.broadcasterId })
  }

  /** GET /games?name= — helper for resolving a category name to its id. */
  async getGameId(name: string): Promise<string | null> {
    const data = await this.get<{ data: unknown[] }>('/games', { name })
    const game = data.data[0] as Record<string, unknown> | undefined
    return game ? String(game['id'] ?? '') : null
  }

  /** POST /streams/markers — `channel:manage:broadcast`. */
  async createStreamMarker(description?: string): Promise<void> {
    await this.post('/streams/markers', {
      user_id: this.broadcasterId,
      ...(description ? { description } : {}),
    })
  }

  /** POST /channels/commercial — `channel:edit:commercial`. */
  async startCommercial(lengthSec: number): Promise<void> {
    await this.post('/channels/commercial', {
      broadcaster_id: this.broadcasterId,
      length: lengthSec,
    })
  }

  /** POST /channels/ads/schedule/snooze — `channel:manage:ads`. */
  async snoozeAd(): Promise<void> {
    await this.post('/channels/ads/schedule/snooze', undefined, {
      broadcaster_id: this.broadcasterId,
    })
  }

  /** PATCH /channel_points/custom_rewards/redemptions — `channel:manage:redemptions`. */
  async updateRedemptionStatus(rewardId: string, redemptionId: string, status: RedemptionStatus): Promise<void> {
    await this.patch('/channel_points/custom_rewards/redemptions', { status }, {
      broadcaster_id: this.broadcasterId,
      reward_id: rewardId,
      id: redemptionId,
    })
  }

  /** POST /moderation/bans — `moderator:manage:banned_users`. Timeout when `durationSec` set, else permanent. */
  async banUser(userId: string, options: BanOptions = {}): Promise<void> {
    const data: Record<string, unknown> = { user_id: userId }
    if (options.durationSec !== undefined) data['duration'] = options.durationSec
    if (options.reason !== undefined) data['reason'] = options.reason
    await this.post('/moderation/bans', { data }, {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
    })
  }

  /** DELETE /moderation/bans — `moderator:manage:banned_users`. */
  async unbanUser(userId: string): Promise<void> {
    await this.del('/moderation/bans', {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
      user_id: userId,
    })
  }

  /** DELETE /moderation/chat — `moderator:manage:chat_messages`. Omit `messageId` to clear all chat. */
  async deleteChatMessage(messageId?: string): Promise<void> {
    await this.del('/moderation/chat', {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
      ...(messageId ? { message_id: messageId } : {}),
    })
  }

  /** PATCH /chat/settings — `moderator:manage:chat_settings`. */
  async updateChatSettings(settings: ChatSettingsUpdate): Promise<void> {
    const body: Record<string, unknown> = {}
    if (settings.emoteOnly !== undefined) body['emote_mode'] = settings.emoteOnly
    if (settings.subscribersOnly !== undefined) body['subscriber_mode'] = settings.subscribersOnly
    if (settings.uniqueChat !== undefined) body['unique_chat_mode'] = settings.uniqueChat
    if (settings.followersOnly !== undefined) {
      body['follower_mode'] = settings.followersOnly !== false
      if (typeof settings.followersOnly === 'number') body['follower_mode_duration'] = settings.followersOnly
    }
    if (settings.slowMode !== undefined) {
      body['slow_mode'] = settings.slowMode !== false
      if (typeof settings.slowMode === 'number') body['slow_mode_wait_time'] = settings.slowMode
    }
    if (Object.keys(body).length === 0) return
    await this.patch('/chat/settings', body, {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
    })
  }

  /** POST /moderation/warnings — `moderator:manage:warnings`. */
  async warnUser(userId: string, reason: string): Promise<void> {
    await this.post('/moderation/warnings', { data: { user_id: userId, reason } }, {
      broadcaster_id: this.broadcasterId,
      moderator_id: this.broadcasterId,
    })
  }

  /** POST /moderation/automod/message — `moderator:manage:automod`. */
  async manageAutoModMessage(messageId: string, action: AutoModAction): Promise<void> {
    await this.post('/moderation/automod/message', {
      user_id: this.broadcasterId,
      msg_id: messageId,
      action,
    })
  }

  /** POST /channels/vips — `channel:manage:vips`. */
  async addVip(userId: string): Promise<void> {
    await this.post('/channels/vips', undefined, {
      broadcaster_id: this.broadcasterId,
      user_id: userId,
    })
  }

  /** DELETE /channels/vips — `channel:manage:vips`. */
  async removeVip(userId: string): Promise<void> {
    await this.del('/channels/vips', {
      broadcaster_id: this.broadcasterId,
      user_id: userId,
    })
  }

  /** POST /moderation/moderators — `channel:manage:moderators`. */
  async addModerator(userId: string): Promise<void> {
    await this.post('/moderation/moderators', undefined, {
      broadcaster_id: this.broadcasterId,
      user_id: userId,
    })
  }

  /** DELETE /moderation/moderators — `channel:manage:moderators`. */
  async removeModerator(userId: string): Promise<void> {
    await this.del('/moderation/moderators', {
      broadcaster_id: this.broadcasterId,
      user_id: userId,
    })
  }

  /** POST /polls — `channel:manage:polls`. */
  async createPoll(spec: PollSpec): Promise<void> {
    const body: Record<string, unknown> = {
      broadcaster_id: this.broadcasterId,
      title: spec.title,
      choices: spec.choices.map((title) => ({ title })),
      duration: spec.durationSec,
    }
    if (spec.channelPointsPerVote && spec.channelPointsPerVote > 0) {
      body['channel_points_voting_enabled'] = true
      body['channel_points_per_vote'] = spec.channelPointsPerVote
    }
    await this.post('/polls', body)
  }

  /** PATCH /polls — `channel:manage:polls`. */
  async endPoll(pollId: string, status: PollEndStatus): Promise<void> {
    await this.patch('/polls', {
      broadcaster_id: this.broadcasterId,
      id: pollId,
      status,
    })
  }

  /** POST /predictions — `channel:manage:predictions`. */
  async createPrediction(spec: PredictionSpec): Promise<void> {
    await this.post('/predictions', {
      broadcaster_id: this.broadcasterId,
      title: spec.title,
      outcomes: spec.outcomes.map((title) => ({ title })),
      prediction_window: spec.windowSec,
    })
  }

  /** PATCH /predictions — `channel:manage:predictions`. */
  async endPrediction(predictionId: string, status: PredictionEndStatus, winningOutcomeId?: string): Promise<void> {
    await this.patch('/predictions', {
      broadcaster_id: this.broadcasterId,
      id: predictionId,
      status,
      ...(winningOutcomeId ? { winning_outcome_id: winningOutcomeId } : {}),
    })
  }

  /** POST /raids — `channel:manage:raids`. */
  async startRaid(toBroadcasterId: string): Promise<void> {
    await this.post('/raids', undefined, {
      from_broadcaster_id: this.broadcasterId,
      to_broadcaster_id: toBroadcasterId,
    })
  }

  /** DELETE /raids — `channel:manage:raids`. */
  async cancelRaid(): Promise<void> {
    await this.del('/raids', { broadcaster_id: this.broadcasterId })
  }

  /** POST /whispers — `user:manage:whispers`. Requires a phone-verified app; rate-limited. */
  async sendWhisper(toUserId: string, message: string): Promise<void> {
    await this.post('/whispers', { message }, {
      from_user_id: this.broadcasterId,
      to_user_id: toUserId,
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
