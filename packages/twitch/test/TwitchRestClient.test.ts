import { describe, it, expect, vi, afterEach } from 'vitest'
import { TwitchRestClient } from '../src/TwitchRestClient.js'

describe('TwitchRestClient.sendChatMessage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to /helix/chat/messages with broadcaster as sender', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }))

    const client = new TwitchRestClient('client-abc', 'tok-123', 'bcast-99')
    await client.sendChatMessage('hello chat')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.twitch.tv/helix/chat/messages')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['Client-Id']).toBe('client-abc')
    expect(headers['Authorization']).toBe('Bearer tok-123')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      broadcaster_id: 'bcast-99',
      sender_id: 'bcast-99',
      message: 'hello chat',
    })
  })

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403, statusText: 'Forbidden' }),
    )
    const client = new TwitchRestClient('c', 't', 'b')
    await expect(client.sendChatMessage('x')).rejects.toThrow(/403/)
  })
})
