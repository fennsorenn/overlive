export interface TwitchAdapterConfig {
  /**
   * Your Twitch application Client ID.
   * Obtain from https://dev.twitch.tv/console
   */
  clientId: string

  /**
   * OAuth access token for the broadcaster or bot account.
   *
   * Required scopes:
   *   - channel:read:redemptions          (channel point redemptions)
   *   - channel:read:subscriptions        (subscriptions)
   *   - bits:read                         (cheers/bits)
   *   - channel:moderate                  (bans, timeouts)
   *   - channel:read:ads                  (ad start/end)
   *   - moderator:read:followers          (follows)
   *   - moderator:read:chat_messages      (chat message delete events)
   *   - user:read:chat                    (chat messages via EventSub)
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
}
