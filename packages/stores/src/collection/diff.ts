import type { Key, Patch } from './types.js'

const DEFAULT_RESET_THRESHOLD = 0.5

/**
 * Computes the minimal set of patches to describe the transition from
 * prevMap to nextMap. Patches are ordered: remove → update → reorder → insert.
 *
 * If the overlap between old and new keys falls below resetThreshold,
 * a single reset patch is returned instead.
 */
export function diff<T>(
  prevMap: ReadonlyMap<Key, T>,
  nextMap: ReadonlyMap<Key, T>,
  equals: (a: T, b: T) => boolean,
  resetThreshold = DEFAULT_RESET_THRESHOLD,
): Patch<T>[] {
  // ─── Reset threshold check ──────────────────────────────────────────────

  if (prevMap.size > 0 || nextMap.size > 0) {
    const prevKeys = new Set(prevMap.keys())
    const nextKeys = new Set(nextMap.keys())
    const overlapCount = countOverlap(prevKeys, nextKeys)
    const unionSize = Math.max(prevMap.size, nextMap.size)
    const ratio = overlapCount / unionSize

    if (ratio < resetThreshold) {
      return [{ op: 'reset', items: [...nextMap.values()] }]
    }
  }

  const patches: Patch<T>[] = []

  const prevKeys = [...prevMap.keys()]
  const nextKeys = [...nextMap.keys()]
  const nextKeySet = new Set(nextKeys)
  const prevKeySet = new Set(prevKeys)

  // ─── Remove ─────────────────────────────────────────────────────────────

  const removedKeys = prevKeys.filter((k) => !nextKeySet.has(k))
  if (removedKeys.length > 0) {
    patches.push({ op: 'remove', keys: removedKeys })
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  const updatedItems: Array<{ key: Key; value: T }> = []
  for (const key of nextKeys) {
    if (!prevKeySet.has(key)) continue // new key, handled by insert
    const prevValue = prevMap.get(key)!
    const nextValue = nextMap.get(key)!
    if (!equals(prevValue, nextValue)) {
      updatedItems.push({ key, value: nextValue })
    }
  }
  if (updatedItems.length > 0) {
    patches.push({ op: 'update', items: updatedItems })
  }

  // ─── Reorder ─────────────────────────────────────────────────────────────
  // Compare the order of surviving keys (keys present in both maps).
  // New keys are not yet inserted, so they don't affect this comparison.

  const survivingInPrev = prevKeys.filter((k) => nextKeySet.has(k))
  const survivingInNext = nextKeys.filter((k) => prevKeySet.has(k))

  if (!arraysEqual(survivingInPrev, survivingInNext)) {
    patches.push({ op: 'reorder', keys: survivingInNext })
  }

  // ─── Insert ──────────────────────────────────────────────────────────────
  // New keys in their final positions within nextMap.

  const insertedItems: Array<{ item: T; index: number }> = []
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]!
    if (!prevKeySet.has(key)) {
      insertedItems.push({ item: nextMap.get(key)!, index: i })
    }
  }
  if (insertedItems.length > 0) {
    patches.push({ op: 'insert', items: insertedItems })
  }

  return patches
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countOverlap<T>(a: Set<T>, b: Set<T>): number {
  let count = 0
  for (const key of a) {
    if (b.has(key)) count++
  }
  return count
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
