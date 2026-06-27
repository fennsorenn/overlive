export interface TwitchAdapterConfig {
  /**
   * Your Twitch application Client ID.
   * Obtain from https://dev.twitch.tv/console
   */
  clientId: string

  /**
   * OAuth access token for the broadcaster or bot account.
   *
   * Inbound (EventSub) scopes:
   *   - channel:read:redemptions          (channel point redemptions)
   *   - channel:read:subscriptions        (subscriptions)
   *   - bits:read                         (cheers/bits)
   *   - channel:moderate                  (bans, timeouts)
   *   - channel:read:ads                  (ad start/end)
   *   - moderator:read:followers          (follows)
   *   - moderator:read:chat_messages      (chat message delete events)
   *   - user:read:chat                    (chat messages via EventSub)
   *
   * Outbound action scopes (PlatformActions) — only needed for the actions you
   * actually use; each REST method documents its own requirement:
   *   - user:write:chat                   (sendChatMessage)
   *   - moderator:manage:announcements    (sendAnnouncement)
   *   - moderator:manage:shoutouts        (sendShoutout)
   *   - user:manage:chat_color            (updateChatColor)
   *   - channel:manage:broadcast          (updateChannel, createStreamMarker)
   *   - channel:edit:commercial           (startCommercial)
   *   - channel:manage:ads                (snoozeAd)
   *   - channel:manage:redemptions        (updateRedemptionStatus)
   *   - moderator:manage:banned_users     (banUser, unbanUser)
   *   - moderator:manage:chat_messages    (deleteChatMessage)
   *   - moderator:manage:chat_settings    (updateChatSettings)
   *   - moderator:manage:warnings         (warnUser)
   *   - moderator:manage:automod          (manageAutoModMessage)
   *   - channel:manage:vips               (addVip, removeVip)
   *   - channel:manage:moderators         (addModerator, removeModerator)
   *   - channel:manage:polls              (createPoll, endPoll)
   *   - channel:manage:predictions        (createPrediction, endPrediction)
   *   - channel:manage:raids              (startRaid, cancelRaid)
   *   - user:manage:whispers              (sendWhisper — also requires a
   *                                        phone-verified app; rate-limited)
   */
  accessToken: string

  /**
   * The broadcaster's Twitch user ID.
   * Required for all EventSub subscriptions.
   */
  broadcasterId: string

  /**
   * The user ID whose chat client to act as for channel.chat.message.
   * This is the account the access token belongs to — typically the
   * broadcaster themselves or a dedicated bot account.
   *
   * Defaults to broadcasterId if not provided.
   */
  userId?: string

  /**
   * Command prefix(es) for chat command detection.
   * Inherits from OverliveKit if not specified.
   * Default: "!"
   */
  commandPrefix?: string | string[]

  /**
   * Twitch application client secret. Required for automatic token refresh.
   * If omitted, the adapter will not attempt to refresh expired tokens —
   * an expired access token will surface as an `error` state with
   * `reason: 'token_expired'` and require manual reconnect.
   */
  clientSecret?: string

  /**
   * Long-lived refresh token paired with the access token. When the access
   * token expires or returns 401, the adapter calls Twitch's token endpoint
   * with this refresh token (and `clientSecret`) to mint a new pair, then
   * invokes `onTokenRefreshed` so the consumer can persist them.
   *
   * Twitch may rotate the refresh token on every refresh — always store
   * the refresh token that comes back, not the one you sent in.
   */
  refreshToken?: string

  /**
   * Called by the adapter after a successful token refresh. The consumer
   * is responsible for persisting the new tokens (e.g. writing them back
   * to a database) — the adapter holds them only in memory.
   */
  onTokenRefreshed?: (tokens: {
    accessToken: string
    refreshToken: string
    expiresIn: number
  }) => void | Promise<void>
}
