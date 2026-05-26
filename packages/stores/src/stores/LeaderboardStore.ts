import type { OverliveKit, RedemptionEvent } from '@overlive/core'
import { createCollectionStore } from '../collection/CollectionStore.js'
import type { CollectionStore } from '../collection/types.js'

export interface LeaderboardEntry {
  username: string
  displayName: string
  /** Accumulated amount in the tracked currency */
  amount: number
  /** ISO 4217 code for tips, 'bits' or 'points' for others */
  currency: string
  /** Number of separate redemptions */
  count: number
  /** Most recent redemption */
  lastSeenAt: Date
}

export type LeaderboardCurrency = 'tip' | 'bits' | 'channel_points' | 'all'

export interface LeaderboardStoreOptions {
  /** Which currency to track. Default: 'all' */
  currency?: LeaderboardCurrency

  /** Maximum entries to retain. Default: 10 */
  limit?: number

  /** Filter to specific channels. */
  channels?: string[]

  /** Initial entries (e.g. seeded from REST top donors). */
  initialEntries?: LeaderboardEntry[]

  resetThreshold?: number
}

export type LeaderboardStore = CollectionStore<LeaderboardEntry>

export function createLeaderboardStore(
  kit: OverliveKit,
  options: LeaderboardStoreOptions = {},
): LeaderboardStore & { seed(entries: LeaderboardEntry[]): void } {
  const limit = options.limit ?? 10
  const currency = options.currency ?? 'all'

  const store = createCollectionStore<LeaderboardEntry>({
    getKey: (entry) => entry.username,
    resetThreshold: options.resetThreshold,
    initialItems: options.initialEntries,
  })

  const sub = kit.on(
    'redemption',
    (event: RedemptionEvent) => {
      const { currency: c } = event.data

      // Filter by tracked currency
      if (currency !== 'all' && c.kind !== currency) return

      const username = event.data.username
      const existing = store.map.get(username)

      const amount = c.kind === 'tip' || c.kind === 'superchat'
        ? c.amount
        : c.kind === 'bits' || c.kind === 'channel_points'
          ? c.amount
          : 0

      const currencyLabel = c.kind === 'tip' || c.kind === 'superchat'
        ? c.currency
        : c.kind

      // Only create a new object if values actually changed
      const newAmount = (existing?.amount ?? 0) + amount
      const newCount = (existing?.count ?? 0) + 1

      const updated: LeaderboardEntry = {
        username,
        displayName: event.data.displayName,
        amount: newAmount,
        currency: currencyLabel,
        count: newCount,
        lastSeenAt: event.timestamp,
      }

      // Build new sorted map — only recreate entries that changed
      const nextMap = new Map(store.map)
      nextMap.set(username, updated)

      // Sort by amount descending, then trim to limit
      const sorted = [...nextMap.entries()]
        .sort(([, a], [, b]) => b.amount - a.amount)
        .slice(0, limit)

      const finalMap = new Map(sorted)
      store.applyMap(finalMap)
    },
    { channels: options.channels },
  )

  store.onDestroy(() => sub.unsubscribe())

  return Object.assign(store, {
    seed(entries: LeaderboardEntry[]): void {
      const sorted = [...entries]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit)
      store.setMany(sorted)
    },
  })
}
