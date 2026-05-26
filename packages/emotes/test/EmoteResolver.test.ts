import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmoteResolver } from '../src/EmoteResolver.js'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response)
}

describe('EmoteResolver', () => {
  let resolver: EmoteResolver

  beforeEach(() => {
    mockFetch.mockReset()
    resolver = new EmoteResolver({
      channelId: '123456',
      twitchClientId: 'client-id',
      twitchAccessToken: 'access-token',
      platforms: ['twitch', '7tv', 'bttv', 'ffz'],
    })
  })

  it('resolves plain text with no emotes into a single text token', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }))

    const tokens = await resolver.resolve('hello world')
    expect(tokens).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('resolves a known BTTV emote by name', async () => {
    // Twitch: empty, 7TV: empty, BTTV: has PogChamp, FFZ: empty
    mockFetch
      .mockResolvedValueOnce(mockResponse({ data: [] }))           // twitch
      .mockResolvedValueOnce(mockResponse({ emote_set: { emotes: [] } })) // 7tv
      .mockResolvedValueOnce(mockResponse({                         // bttv
        channelEmotes: [{
          id: 'abc123',
          code: 'PogChamp',
          imageType: 'png',
        }],
        sharedEmotes: [],
      }))
      .mockResolvedValueOnce(mockResponse({ sets: {} }))            // ffz

    const tokens = await resolver.resolve('hello PogChamp world')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'hello' })
    expect(tokens[1]).toMatchObject({
      type: 'emote',
      emote: { name: 'PogChamp', platform: 'bttv' },
    })
    expect(tokens[2]).toEqual({ type: 'text', value: 'world' })
  })

  it('resolves @mentions', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }))

    const tokens = await resolver.resolve('hey @streamer')
    expect(tokens).toContainEqual({ type: 'mention', username: 'streamer' })
  })

  it('resolves URLs', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: [] }))

    const tokens = await resolver.resolve('check https://twitch.tv out')
    expect(tokens).toContainEqual({
      type: 'url',
      href: 'https://twitch.tv',
      display: 'https://twitch.tv',
    })
  })

  it('uses cache on second call — fetch called only once per platform', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ data: [] }))
      .mockResolvedValueOnce(mockResponse({ emote_set: { emotes: [] } }))
      .mockResolvedValueOnce(mockResponse({ channelEmotes: [], sharedEmotes: [] }))
      .mockResolvedValueOnce(mockResponse({ sets: {} }))

    await resolver.resolve('hello')
    await resolver.resolve('world')

    // Four platforms fetched once each — not twice
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('invalidate clears the cache', async () => {
    mockFetch
      .mockResolvedValue(mockResponse({ data: [], emote_set: { emotes: [] }, channelEmotes: [], sharedEmotes: [], sets: {} }))

    await resolver.resolve('hello')
    resolver.invalidate()
    await resolver.resolve('hello')

    // Should fetch again after invalidation
    expect(mockFetch.mock.calls.length).toBeGreaterThan(4)
  })

  it('gracefully handles a failed platform fetch', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({}, false))   // twitch fails
      .mockResolvedValueOnce(mockResponse({ emote_set: { emotes: [] } }))
      .mockResolvedValueOnce(mockResponse({ channelEmotes: [], sharedEmotes: [] }))
      .mockResolvedValueOnce(mockResponse({ sets: {} }))

    // Should not throw
    const tokens = await resolver.resolve('hello world')
    expect(tokens).toEqual([{ type: 'text', value: 'hello world' }])
  })
})
