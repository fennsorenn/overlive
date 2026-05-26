import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OverliveKit } from '../src/OverliveKit.js'
import type { PlatformAdapter, AdapterEventHandler, SuppressionMap } from '../src/adapter/types.js'
import type { OverliveEvent, RedemptionEvent } from '../src/events/types.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeAdapter(
  platform: string,
  suppressedBy: SuppressionMap = {},
): PlatformAdapter & { emit: (e: OverliveEvent) => void } {
  let handler: AdapterEventHandler | null = null

  return {
    platform,
    suppressedBy,
    state: 'connected',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onEvent(h) { handler = h },
    emit(event) { handler?.(event) },
  }
}

function makeRedemption(platform: string, override: Partial<RedemptionEvent> = {}): RedemptionEvent {
  return {
    id: 'test-id',
    type: 'redemption',
    platform,
    channel: 'testchannel',
    timestamp: new Date(),
    raw: {},
    data: {
      username: 'testuser',
      displayName: 'TestUser',
      currency: { kind: 'tip', amount: 5, currency: 'USD', formattedAmount: '$5.00' },
    },
    ...override,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OverliveKit', () => {
  let kit: OverliveKit

  beforeEach(() => {
    kit = new OverliveKit()
  })

  it('emits events from a registered adapter', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    const handler = vi.fn()
    kit.on('redemption', handler)

    adapter.emit(makeRedemption('twitch'))
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
  })

  it('calls connect on all adapters', async () => {
    const a = makeAdapter('twitch')
    const b = makeAdapter('streamelements')
    kit.use(a).use(b)
    await kit.connect()
    expect(a.connect).toHaveBeenCalledOnce()
    expect(b.connect).toHaveBeenCalledOnce()
  })

  it('suppresses events when a higher-priority adapter is present', async () => {
    const twitch = makeAdapter('twitch')
    const se = makeAdapter('streamelements', {
      subscription: ['twitch'], // SE subs suppressed when Twitch is present
    })

    kit.use(twitch).use(se)

    const handler = vi.fn()
    kit.on('subscription', handler)

    // SE fires a subscription — should be suppressed
    se.emit({
      id: 'sub-1',
      type: 'subscription',
      platform: 'streamelements',
      channel: 'testchannel',
      timestamp: new Date(),
      raw: {},
      data: {
        username: 'viewer',
        displayName: 'Viewer',
        tier: 'tier1',
        months: 1,
        isFirst: true,
        isResub: false,
        isGift: false,
      },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(handler).not.toHaveBeenCalled()
  })

  it('does NOT suppress if the priority adapter is not registered', async () => {
    // SE alone — no Twitch — should emit subs fine
    const se = makeAdapter('streamelements', {
      subscription: ['twitch'],
    })

    kit.use(se)

    const handler = vi.fn()
    kit.on('subscription', handler)

    se.emit({
      id: 'sub-1',
      type: 'subscription',
      platform: 'streamelements',
      channel: 'testchannel',
      timestamp: new Date(),
      raw: {},
      data: {
        username: 'viewer',
        displayName: 'Viewer',
        tier: 'tier1',
        months: 1,
        isFirst: true,
        isResub: false,
        isGift: false,
      },
    })

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
  })

  it('onAny receives all event types', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    const handler = vi.fn()
    kit.onAny(handler)

    adapter.emit(makeRedemption('twitch'))

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
  })

  it('once fires exactly one time', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    const handler = vi.fn()
    kit.once('redemption', handler)

    adapter.emit(makeRedemption('twitch'))
    adapter.emit(makeRedemption('twitch'))

    await new Promise((r) => setTimeout(r, 20))
    expect(handler).toHaveBeenCalledOnce()
  })

  it('filters by channel when specified in options', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    const handler = vi.fn()
    kit.on('redemption', handler, { channels: ['channelA'] })

    adapter.emit(makeRedemption('twitch', { channel: 'channelB' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(handler).not.toHaveBeenCalled()

    adapter.emit(makeRedemption('twitch', { channel: 'channelA' }))
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
  })

  it('subscription returns an unsubscribe function', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    const handler = vi.fn()
    const sub = kit.on('redemption', handler)

    sub.unsubscribe()
    adapter.emit(makeRedemption('twitch'))

    await new Promise((r) => setTimeout(r, 10))
    expect(handler).not.toHaveBeenCalled()
  })

  it('custom middleware can drop events', async () => {
    const adapter = makeAdapter('twitch')
    kit.use(adapter)

    kit.middleware(async (_event, _next) => {
      // drop everything
    })

    const handler = vi.fn()
    kit.on('redemption', handler)

    adapter.emit(makeRedemption('twitch'))

    await new Promise((r) => setTimeout(r, 10))
    expect(handler).not.toHaveBeenCalled()
  })
})
