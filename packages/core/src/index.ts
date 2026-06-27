// Main entry point
export { OverliveKit } from './OverliveKit.js'
export type { OverliveKitOptions } from './OverliveKit.js'

// Event types
export type {
  OverliveEvent,
  EventType,
  EventByType,
  Platform,
  BaseEvent,
  RedemptionEvent,
  RedemptionCurrency,
  SubscriptionEvent,
  SubscriptionTier,
  GiftBombEvent,
  RaidEvent,
  FollowEvent,
  ChatMessageEvent,
  ChatCommandEvent,
  AdStartEvent,
  AdEndEvent,
  BanEvent,
  DeleteMessageEvent,
  StreamOnlineEvent,
  StreamOfflineEvent,
  ResolvedEmote,
  EmotePlatform,
  MessageToken,
  AdapterEmittedEvent,
} from './events/types.js'

// Registry
export type { RegistryEntry } from './adapter/AdapterRegistry.js'

// Adapter interface — for adapter package authors
export type {
  PlatformAdapter,
  RestCapableAdapter,
  AdapterRestClient,
  AdapterEventHandler,
  SuppressionMap,
  ConnectionState,
  AdapterStateInfo,
  AdapterStateReason,
} from './adapter/types.js'
export { isRestCapable } from './adapter/types.js'

// Outbound platform actions — capability surface for write-capable adapters
export type {
  PlatformActions,
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
} from './adapter/actions.js'
export { supportsActions } from './adapter/actions.js'

// Kit-level adapter state observability
export type { AdapterStateSnapshot, AdapterStateListener } from './OverliveKit.js'

// Bus
export type { SubscribeOptions, Subscription } from './bus/TypedEventBus.js'

// Middleware
export type { Middleware, MiddlewareNext } from './middleware/pipeline.js'
export { createLoggingMiddleware } from './middleware/pipeline.js'

// REST
export { UnifiedRestClient } from './rest/UnifiedRestClient.js'
export type { TopDonor, ClipResult, StreamInfo, ChattersResult } from './rest/UnifiedRestClient.js'
