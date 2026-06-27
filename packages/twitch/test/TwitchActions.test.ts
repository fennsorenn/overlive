import { describe, it, expect, vi, afterEach } from 'vitest'
import { TwitchRestClient } from '../src/TwitchRestClient.js'

/** Spy on fetch returning an empty 204-style ok response. */
function mockFetch(body = '', status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }))
}

/** Pull the (url, init) of the Nth fetch call as plain objects. */
function call(fetchMock: ReturnType<typeof mockFetch>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n]
  return {
    url: new URL(String(url)),
    method: init?.method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    headers: init?.headers as Record<string, string>,
  }
}

const client = () => new TwitchRestClient('cid', 'tok', 'bcast')

describe('TwitchRestClient outbound actions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sendAnnouncement POSTs with moderator_id and color', async () => {
    const f = mockFetch()
    await client().sendAnnouncement('hi', 'purple')
    const c = call(f)
    expect(c.method).toBe('POST')
    expect(c.url.pathname).toBe('/helix/chat/announcements')
    expect(c.url.searchParams.get('broadcaster_id')).toBe('bcast')
    expect(c.url.searchParams.get('moderator_id')).toBe('bcast')
    expect(c.body).toEqual({ message: 'hi', color: 'purple' })
  })

  it('sendAnnouncement defaults color to primary', async () => {
    const f = mockFetch()
    await client().sendAnnouncement('hi')
    expect(call(f).body).toEqual({ message: 'hi', color: 'primary' })
  })

  it('sendShoutout passes from/to/moderator as query, no body', async () => {
    const f = mockFetch()
    await client().sendShoutout('target-1')
    const c = call(f)
    expect(c.method).toBe('POST')
    expect(c.url.pathname).toBe('/helix/chat/shoutouts')
    expect(c.url.searchParams.get('from_broadcaster_id')).toBe('bcast')
    expect(c.url.searchParams.get('to_broadcaster_id')).toBe('target-1')
    expect(c.body).toBeUndefined()
    expect(c.headers['Content-Type']).toBeUndefined()
  })

  it('updateChatColor PUTs user_id + color', async () => {
    const f = mockFetch()
    await client().updateChatColor('blue')
    const c = call(f)
    expect(c.method).toBe('PUT')
    expect(c.url.pathname).toBe('/helix/chat/color')
    expect(c.url.searchParams.get('user_id')).toBe('bcast')
    expect(c.url.searchParams.get('color')).toBe('blue')
  })

  it('createStreamMarker POSTs user_id + optional description', async () => {
    const f = mockFetch()
    await client().createStreamMarker('big play')
    expect(call(f).body).toEqual({ user_id: 'bcast', description: 'big play' })
  })

  it('startCommercial POSTs length', async () => {
    const f = mockFetch()
    await client().startCommercial(60)
    expect(call(f).body).toEqual({ broadcaster_id: 'bcast', length: 60 })
  })

  it('snoozeAd POSTs with broadcaster_id query, no body', async () => {
    const f = mockFetch()
    await client().snoozeAd()
    const c = call(f)
    expect(c.url.pathname).toBe('/helix/channels/ads/schedule/snooze')
    expect(c.body).toBeUndefined()
  })

  it('updateRedemptionStatus PATCHes status with reward+redemption ids', async () => {
    const f = mockFetch()
    await client().updateRedemptionStatus('rew-1', 'red-9', 'FULFILLED')
    const c = call(f)
    expect(c.method).toBe('PATCH')
    expect(c.url.pathname).toBe('/helix/channel_points/custom_rewards/redemptions')
    expect(c.url.searchParams.get('reward_id')).toBe('rew-1')
    expect(c.url.searchParams.get('id')).toBe('red-9')
    expect(c.body).toEqual({ status: 'FULFILLED' })
  })

  it('banUser as permanent ban omits duration', async () => {
    const f = mockFetch()
    await client().banUser('u-1', { reason: 'spam' })
    expect(call(f).body).toEqual({ data: { user_id: 'u-1', reason: 'spam' } })
  })

  it('banUser as timeout includes duration', async () => {
    const f = mockFetch()
    await client().banUser('u-1', { durationSec: 600 })
    expect(call(f).body).toEqual({ data: { user_id: 'u-1', duration: 600 } })
  })

  it('unbanUser DELETEs with user_id', async () => {
    const f = mockFetch()
    await client().unbanUser('u-2')
    const c = call(f)
    expect(c.method).toBe('DELETE')
    expect(c.url.pathname).toBe('/helix/moderation/bans')
    expect(c.url.searchParams.get('user_id')).toBe('u-2')
  })

  it('deleteChatMessage with id sets message_id; without id clears chat', async () => {
    const f1 = mockFetch()
    await client().deleteChatMessage('m-1')
    expect(call(f1).url.searchParams.get('message_id')).toBe('m-1')
    vi.restoreAllMocks()
    const f2 = mockFetch()
    await client().deleteChatMessage()
    expect(call(f2).url.searchParams.get('message_id')).toBeNull()
  })

  it('updateChatSettings maps followers number → mode + duration', async () => {
    const f = mockFetch()
    await client().updateChatSettings({ followersOnly: 10, emoteOnly: true, slowMode: false })
    expect(call(f).body).toEqual({
      emote_mode: true,
      follower_mode: true,
      follower_mode_duration: 10,
      slow_mode: false,
    })
  })

  it('updateChatSettings with no fields makes no request', async () => {
    const f = mockFetch()
    await client().updateChatSettings({})
    expect(f).not.toHaveBeenCalled()
  })

  it('warnUser POSTs data.user_id + reason', async () => {
    const f = mockFetch()
    await client().warnUser('u-3', 'be nice')
    expect(call(f).body).toEqual({ data: { user_id: 'u-3', reason: 'be nice' } })
  })

  it('manageAutoModMessage POSTs msg_id + action + user_id', async () => {
    const f = mockFetch()
    await client().manageAutoModMessage('msg-7', 'DENY')
    expect(call(f).body).toEqual({ user_id: 'bcast', msg_id: 'msg-7', action: 'DENY' })
  })

  it('addVip / removeVip hit /channels/vips with the right verb', async () => {
    const f1 = mockFetch()
    await client().addVip('v-1')
    expect(call(f1).method).toBe('POST')
    vi.restoreAllMocks()
    const f2 = mockFetch()
    await client().removeVip('v-1')
    const c = call(f2)
    expect(c.method).toBe('DELETE')
    expect(c.url.pathname).toBe('/helix/channels/vips')
  })

  it('createPoll maps choices and enables channel points when cost set', async () => {
    const f = mockFetch()
    await client().createPoll({ title: 'Best?', choices: ['A', 'B'], durationSec: 120, channelPointsPerVote: 50 })
    expect(call(f).body).toEqual({
      broadcaster_id: 'bcast',
      title: 'Best?',
      choices: [{ title: 'A' }, { title: 'B' }],
      duration: 120,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 50,
    })
  })

  it('endPoll PATCHes status', async () => {
    const f = mockFetch()
    await client().endPoll('poll-1', 'TERMINATED')
    expect(call(f).body).toEqual({ broadcaster_id: 'bcast', id: 'poll-1', status: 'TERMINATED' })
  })

  it('createPrediction maps outcomes + window', async () => {
    const f = mockFetch()
    await client().createPrediction({ title: 'Win?', outcomes: ['Yes', 'No'], windowSec: 90 })
    expect(call(f).body).toEqual({
      broadcaster_id: 'bcast',
      title: 'Win?',
      outcomes: [{ title: 'Yes' }, { title: 'No' }],
      prediction_window: 90,
    })
  })

  it('endPrediction includes winning_outcome_id only when resolving', async () => {
    const f = mockFetch()
    await client().endPrediction('p-1', 'RESOLVED', 'out-2')
    expect(call(f).body).toEqual({ broadcaster_id: 'bcast', id: 'p-1', status: 'RESOLVED', winning_outcome_id: 'out-2' })
  })

  it('startRaid / cancelRaid hit /raids', async () => {
    const f1 = mockFetch()
    await client().startRaid('to-1')
    const c1 = call(f1)
    expect(c1.method).toBe('POST')
    expect(c1.url.searchParams.get('to_broadcaster_id')).toBe('to-1')
    vi.restoreAllMocks()
    const f2 = mockFetch()
    await client().cancelRaid()
    expect(call(f2).method).toBe('DELETE')
  })

  it('sendWhisper POSTs message with from/to query', async () => {
    const f = mockFetch()
    await client().sendWhisper('to-9', 'hey')
    const c = call(f)
    expect(c.url.pathname).toBe('/helix/whispers')
    expect(c.url.searchParams.get('from_user_id')).toBe('bcast')
    expect(c.url.searchParams.get('to_user_id')).toBe('to-9')
    expect(c.body).toEqual({ message: 'hey' })
  })

  it('updateChannel resolves categoryName → game_id via /games', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'game-42' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    await client().updateChannel({ title: 'New', categoryName: 'Just Chatting' })
    const lookup = call(f, 0)
    expect(lookup.url.pathname).toBe('/helix/games')
    expect(lookup.url.searchParams.get('name')).toBe('Just Chatting')
    const patch = call(f, 1)
    expect(patch.method).toBe('PATCH')
    expect(patch.body).toEqual({ title: 'New', game_id: 'game-42' })
  })

  it('updateChannel with no fields makes no request', async () => {
    const f = mockFetch()
    await client().updateChannel({})
    expect(f).not.toHaveBeenCalled()
  })

  it('propagates non-ok responses as errors', async () => {
    mockFetch('nope', 403)
    await expect(client().banUser('u')).rejects.toThrow(/403/)
  })
})
