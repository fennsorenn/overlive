// ─── Outbound platform actions ────────────────────────────────────────────────
//
// Capability surface for adapters that can perform *write* actions on a
// platform (send chat, moderate, run polls, etc.) — as opposed to the read-only
// `AdapterRestClient` and the inbound event stream.
//
// Every method is optional: an adapter implements only the actions its platform
// supports, and consumers feature-detect at call time (`if (adapter.banUser)`).
// `PlatformAdapter` does NOT require this interface — adapters opt in by also
// implementing `PlatformActions`, and callers narrow with `supportsActions()`.

/** Highlight color for a chat announcement. `primary` uses the channel color. */
export type AnnouncementColor = 'blue' | 'green' | 'orange' | 'purple' | 'primary'

/** Partial channel metadata update. Only the provided fields are changed. */
export interface ChannelUpdate {
  /** Stream title. */
  title?: string
  /** Category/game by platform id. Takes precedence over `categoryName`. */
  categoryId?: string
  /** Category/game by name — the adapter resolves it to an id if supported. */
  categoryName?: string
  /** Broadcaster language as an ISO-639-1 code (e.g. `en`, `de`). */
  language?: string
  /** Stream tags (replaces the existing set). */
  tags?: string[]
}

/**
 * Partial chat-mode update. Booleans toggle a mode; the duration variants set
 * the mode *and* its window in one call.
 */
export interface ChatSettingsUpdate {
  /** Emote-only mode. */
  emoteOnly?: boolean
  /** Followers-only mode. `true` → 0-minute minimum; a number → minutes. */
  followersOnly?: boolean | number
  /** Slow mode. `true` → default wait; a number → seconds between messages. */
  slowMode?: boolean | number
  /** Subscribers-only mode. */
  subscribersOnly?: boolean
  /** Unique-chat ("r9k") mode. */
  uniqueChat?: boolean
}

/** Ban (permanent if `durationSec` omitted) or timeout options. */
export interface BanOptions {
  /** Timeout length in seconds. Omit for a permanent ban. */
  durationSec?: number
  /** Reason recorded in the mod log and shown to the user. */
  reason?: string
}

/** Specification for creating a poll. */
export interface PollSpec {
  title: string
  /** 2–5 choice labels. */
  choices: string[]
  /** Poll duration in seconds (15–1800). */
  durationSec: number
  /** If set (>0), enables Channel-Points voting at this cost per extra vote. */
  channelPointsPerVote?: number
}

/** Specification for creating a prediction. */
export interface PredictionSpec {
  title: string
  /** 2–10 outcome labels. */
  outcomes: string[]
  /** Window during which viewers can predict, in seconds (30–1800). */
  windowSec: number
}

export type RedemptionStatus = 'FULFILLED' | 'CANCELED'
export type PollEndStatus = 'TERMINATED' | 'ARCHIVED'
export type PredictionEndStatus = 'RESOLVED' | 'CANCELED' | 'LOCKED'
export type AutoModAction = 'ALLOW' | 'DENY'

/**
 * Outbound write actions. All optional and feature-detected by callers. Twitch
 * implements the full set today; other platforms implement what they can.
 */
export interface PlatformActions {
  // ─── Chat ───────────────────────────────────────────────────────────────
  /** Post a chat message to the channel. */
  sendChatMessage?(text: string): Promise<void>
  /** Post a highlighted announcement to chat. */
  sendAnnouncement?(message: string, color?: AnnouncementColor): Promise<void>
  /** Give another channel a shoutout. */
  sendShoutout?(toBroadcasterId: string): Promise<void>
  /** Update the broadcaster's own chat name color (named or `#hex`). */
  updateChatColor?(color: string): Promise<void>

  // ─── Channel / broadcast ────────────────────────────────────────────────
  /** Update channel metadata (title, category, language, tags). */
  updateChannel?(update: ChannelUpdate): Promise<void>
  /** Drop a marker at the current stream position. */
  createStreamMarker?(description?: string): Promise<void>
  /** Start a commercial of the given length (seconds). */
  startCommercial?(lengthSec: number): Promise<void>
  /** Snooze the next scheduled mid-roll ad. */
  snoozeAd?(): Promise<void>

  // ─── Channel points ─────────────────────────────────────────────────────
  /** Fulfil or cancel a channel-point redemption. */
  updateRedemptionStatus?(rewardId: string, redemptionId: string, status: RedemptionStatus): Promise<void>

  // ─── Moderation ─────────────────────────────────────────────────────────
  /** Ban (no duration) or timeout (with duration) a user. */
  banUser?(userId: string, options?: BanOptions): Promise<void>
  /** Lift a ban/timeout. */
  unbanUser?(userId: string): Promise<void>
  /** Delete a single chat message, or clear the whole chat if `messageId` is omitted. */
  deleteChatMessage?(messageId?: string): Promise<void>
  /** Update chat modes (emote/followers/slow/subscribers/unique). */
  updateChatSettings?(settings: ChatSettingsUpdate): Promise<void>
  /** Issue a warning to a user. */
  warnUser?(userId: string, reason: string): Promise<void>
  /** Approve or deny a message held by AutoMod. */
  manageAutoModMessage?(messageId: string, action: AutoModAction): Promise<void>

  // ─── Roles ──────────────────────────────────────────────────────────────
  addVip?(userId: string): Promise<void>
  removeVip?(userId: string): Promise<void>
  addModerator?(userId: string): Promise<void>
  removeModerator?(userId: string): Promise<void>

  // ─── Interactive ────────────────────────────────────────────────────────
  createPoll?(spec: PollSpec): Promise<void>
  endPoll?(pollId: string, status: PollEndStatus): Promise<void>
  createPrediction?(spec: PredictionSpec): Promise<void>
  endPrediction?(predictionId: string, status: PredictionEndStatus, winningOutcomeId?: string): Promise<void>
  startRaid?(toBroadcasterId: string): Promise<void>
  cancelRaid?(): Promise<void>

  // ─── Direct messages ────────────────────────────────────────────────────
  /**
   * Send a whisper. NOTE: Twitch requires the sending app to have a verified
   * phone number and heavily rate-limits whispers; this may fail with 401/429
   * even when the scope is present.
   */
  sendWhisper?(toUserId: string, message: string): Promise<void>
}

/** Narrowing helper: does this adapter expose at least one outbound action? */
export function supportsActions(adapter: object): adapter is PlatformActions {
  const a = adapter as Record<string, unknown>
  return typeof a['sendChatMessage'] === 'function' || typeof a['banUser'] === 'function'
}
