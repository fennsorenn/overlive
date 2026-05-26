# overlive

Unified live stream meta-event SDK. One interface for everything Twitch and StreamElements expose — subscriptions, bits, tips, channel points, chat, commands, raids, ads, bans, and more — with a clean adapter pattern for adding other platforms.

```
@overlive/core     — event bus, adapter registry, middleware, unified REST
@overlive/twitch   — Twitch EventSub + IRC + Helix REST
@overlive/se       — StreamElements WebSocket + REST
@overlive/emotes   — emote resolution (Twitch, 7TV, BTTV, FFZ)
```

## Install

```bash
pnpm add @overlive/core @overlive/twitch @overlive/se @overlive/emotes
```

## Usage

```ts
import { OverliveKit } from '@overlive/core'
import { TwitchAdapter } from '@overlive/twitch'
import { SEAdapter } from '@overlive/se'
import { EmoteResolver } from '@overlive/emotes'

const kit = new OverliveKit({ debug: true })

// Register adapters — order doesn't matter
kit.use(new TwitchAdapter({
  clientId: process.env.TWITCH_CLIENT_ID!,
  accessToken: process.env.TWITCH_ACCESS_TOKEN!,
  broadcasterId: process.env.TWITCH_BROADCASTER_ID!,
  channels: ['mychannel'],
}))

kit.use(new SEAdapter({
  jwt: process.env.SE_JWT!,
  channelId: process.env.SE_CHANNEL_ID!,
}))

// Connect all adapters
await kit.connect()

// ─── Events ──────────────────────────────────────────────────────────────────

// Bits, channel points, and tips — all as 'redemption', differentiated by currency
kit.on('redemption', (e) => {
  switch (e.data.currency.kind) {
    case 'bits':
      console.log(`${e.data.displayName} cheered ${e.data.currency.amount} bits`)
      break
    case 'channel_points':
      console.log(`${e.data.displayName} redeemed "${e.data.currency.rewardTitle}"`)
      break
    case 'tip':
      console.log(`${e.data.displayName} tipped ${e.data.currency.formattedAmount}`)
      break
  }
})

// Subscriptions (SE subs auto-suppressed when Twitch adapter is present)
kit.on('subscription', (e) => {
  console.log(`${e.data.displayName} subscribed (${e.data.tier}, ${e.data.months} months)`)
})

// Gift bombs
kit.on('gift_bomb', (e) => {
  console.log(`${e.data.gifter.displayName} gifted ${e.data.count} subs!`)
})

// Chat messages — with optional emote resolution per subscriber
const emoteResolver = new EmoteResolver({
  channelId: process.env.TWITCH_BROADCASTER_ID!,
  twitchClientId: process.env.TWITCH_CLIENT_ID!,
  twitchAccessToken: process.env.TWITCH_ACCESS_TOKEN!,
})
await emoteResolver.warmup()

kit.on('chat.message', async (e) => {
  const tokens = await emoteResolver.resolve(e.data.text)
  console.log(tokens)
}, { resolveEmotes: true })

// Chat commands
kit.on('chat.command', (e) => {
  if (e.data.command === 'points') {
    // respond to !points
  }
})

// Raids
kit.on('raid', (e) => {
  console.log(`${e.data.from.displayName} raided with ${e.data.viewerCount} viewers!`)
})

// Ads
kit.on('ad.start', (e) => {
  console.log(`Ad break started — ${e.data.durationSeconds}s`)
})
kit.on('ad.end', (e) => {
  console.log(`Ad break ended after ${e.data.durationSeconds}s`)
})

// Bans and timeouts
kit.on('ban', (e) => {
  if (e.data.isPermanent) {
    console.log(`${e.data.username} was banned`)
  } else {
    console.log(`${e.data.username} was timed out for ${e.data.timeoutSeconds}s`)
  }
})

// ─── REST ─────────────────────────────────────────────────────────────────────

// Merged across all platforms
const topDonors = await kit.rest.getTopDonors({ limit: 10, period: 'month' })

// Platform-specific REST access
const rewards = await kit.rest.platform('twitch').getChannelRewards()
const points = await kit.rest.platform('streamelements').getUserPoints('viewer123')

// Filter by platform
const clips = await kit.rest.getClips({ platform: 'twitch', limit: 5 })

// ─── Middleware ───────────────────────────────────────────────────────────────

// Drop events from channels you don't care about
kit.middleware(async (event, next) => {
  if (event.channel !== 'mychannel') return
  await next(event)
})

// ─── Subscriptions ────────────────────────────────────────────────────────────

// Scoped to specific channel
kit.on('redemption', handler, { channels: ['channelA', 'channelB'] })

// One-shot
kit.once('stream.online', (e) => console.log('Stream is live!'))

// Unsubscribe
const sub = kit.on('chat.message', handler)
sub.unsubscribe()
```

## Writing an adapter

Implement `PlatformAdapter` from `@overlive/core`:

```ts
import type { PlatformAdapter, AdapterEventHandler, SuppressionMap } from '@overlive/core'

export class KickAdapter implements PlatformAdapter {
  readonly platform = 'kick'
  readonly displayName = 'Kick'

  // Tell core which events Twitch takes priority over
  readonly suppressedBy: SuppressionMap = {
    subscription:   ['twitch'],
    follow:         ['twitch'],
    'chat.message': ['twitch'],
  }

  state = 'disconnected' as const
  private handler: AdapterEventHandler | null = null

  onEvent(handler: AdapterEventHandler) { this.handler = handler }

  async connect() { /* connect to Kick WS */ }
  async disconnect() { /* clean up */ }
}
```

## License

MIT
