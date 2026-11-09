import { describe, it, expect, vi, afterEach } from 'vitest'
import { TwitchRestClient } from '../src/TwitchRestClient.js'
import { normalizeGoal, goalKind } from '../src/normalizers.js'

const ref = { slug: 'streamer', id: 'bcast-99' }

describe('creator goals', () => {
  afterEach(() => vi.restoreAllMocks())

  it('normalizes channel.goal.* payloads into one goal event', () => {
    const raw = {
      id: 'g1',
      type: 'new_subscription',
      description: 'Road to 50',
      current_amount: 12,
      target_amount: 50,
      started_at: '2026-11-09T10:00:00Z',
    }
    const e = normalizeGoal(raw, 'progress', ref)
    expect(e.type).toBe('goal')
    expect(e.channel).toBe('streamer')
    expect(e.data).toMatchObject({
      goalId: 'g1',
      kind: 'new_subscription',
      description: 'Road to 50',
      current: 12,
      target: 50,
      phase: 'progress',
      achieved: false,
    })
    expect(e.data.startedAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z')
    expect(e.data.endedAt).toBeUndefined()
  })

  it('reports achieved only on end', () => {
    const raw = { id: 'g1', type: 'follow', is_achieved: true, ended_at: '2026-11-09T12:00:00Z' }
    expect(normalizeGoal(raw, 'progress', ref).data.achieved).toBe(false)
    const end = normalizeGoal(raw, 'end', ref)
    expect(end.data.achieved).toBe(true)
    expect(end.data.endedAt?.toISOString()).toBe('2026-11-09T12:00:00.000Z')
  })

  it("maps Helix's 'follower' to 'follow'", () => {
    expect(goalKind('follower')).toBe('follow')
    expect(goalKind('subscription_count')).toBe('subscription_count')
  })

  it('getGoals reads /helix/goals for the broadcaster', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'g1',
              type: 'follower',
              description: 'Follows',
              current_amount: 7,
              target_amount: 100,
              created_at: '2026-11-01T00:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )
    const client = new TwitchRestClient('c', 't', 'bcast-99')
    const goals = await client.getGoals()
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.twitch.tv/helix/goals?broadcaster_id=bcast-99')
    expect(goals).toEqual([
      {
        id: 'g1',
        kind: 'follow',
        description: 'Follows',
        current: 7,
        target: 100,
        startedAt: new Date('2026-11-01T00:00:00Z'),
        platform: 'twitch',
      },
    ])
  })
})
