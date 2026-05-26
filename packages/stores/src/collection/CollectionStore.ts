import { diff } from './diff.js'
import type {
  Key,
  Patch,
  CollectionStore,
  CollectionStoreOptions,
  CollectionSubscriber,
  AppendSubscriber,
  RemoveSubscriber,
  ReorderSubscriber,
  UpdateSubscriber,
  ResetSubscriber,
  Unsubscribe,
} from './types.js'

const referenceEquals = <T>(a: T, b: T): boolean => a === b

export class CollectionStoreImpl<T> implements CollectionStore<T> {
  private _map: Map<Key, T>
  private readonly getKey: (item: T) => Key
  private readonly equals: (a: T, b: T) => boolean
  private readonly resetThreshold: number

  // Subscriber sets per event type
  private readonly allSubscribers = new Set<CollectionSubscriber<T>>()
  private readonly insertSubscribers = new Set<AppendSubscriber<T>>()
  private readonly removeSubscribers = new Set<RemoveSubscriber>()
  private readonly reorderSubscribers = new Set<ReorderSubscriber>()
  private readonly updateSubscribers = new Set<UpdateSubscriber<T>>()
  private readonly resetSubscribers = new Set<ResetSubscriber<T>>()

  // Cached derived array — only rebuilt when the map changes
  private _items: T[] | null = null
  private readonly destroyCallbacks = new Set<() => void>()

  constructor(options: CollectionStoreOptions<T>) {
    this.getKey = options.getKey
    this.equals = options.equals ?? referenceEquals
    this.resetThreshold = options.resetThreshold ?? 0.5
    this._map = new Map()

    if (options.initialItems && options.initialItems.length > 0) {
      for (const item of options.initialItems) {
        this._map.set(this.getKey(item), item)
      }
    }
  }

  // ─── Public read interface ─────────────────────────────────────────────────

  get items(): T[] {
    if (this._items === null) {
      this._items = [...this._map.values()]
    }
    return this._items
  }

  get map(): ReadonlyMap<Key, T> {
    return this._map
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  subscribe(fn: CollectionSubscriber<T>): Unsubscribe {
    this.allSubscribers.add(fn)
    return () => this.allSubscribers.delete(fn)
  }

  onInsert(fn: AppendSubscriber<T>): Unsubscribe {
    this.insertSubscribers.add(fn)
    return () => this.insertSubscribers.delete(fn)
  }

  onRemove(fn: RemoveSubscriber): Unsubscribe {
    this.removeSubscribers.add(fn)
    return () => this.removeSubscribers.delete(fn)
  }

  onReorder(fn: ReorderSubscriber): Unsubscribe {
    this.reorderSubscribers.add(fn)
    return () => this.reorderSubscribers.delete(fn)
  }

  onUpdate(fn: UpdateSubscriber<T>): Unsubscribe {
    this.updateSubscribers.add(fn)
    return () => this.updateSubscribers.delete(fn)
  }

  onReset(fn: ResetSubscriber<T>): Unsubscribe {
    this.resetSubscribers.add(fn)
    return () => this.resetSubscribers.delete(fn)
  }

  // ─── Mutation API (internal use) ───────────────────────────────────────────

  /**
   * Apply a new map state. Diffs against current state and notifies subscribers.
   * This is the single internal mutation path — all higher-level operations
   * (set, delete, clear, etc.) build a new map and call this.
   */
  applyMap(nextMap: Map<Key, T>): void {
    const patches = diff(this._map, nextMap, this.equals, this.resetThreshold)
    if (patches.length === 0) return

    this._map = nextMap
    this._items = null // invalidate cache

    this.notifyPatches(patches)
  }

  /**
   * Upsert a single item. Only produces a new map entry if the item
   * is actually new or changed — reference stability is preserved for
   * unchanged items.
   */
  set(item: T): void {
    const key = this.getKey(item)
    const existing = this._map.get(key)

    // If same reference, nothing to do
    if (existing === item) return

    const nextMap = new Map(this._map)
    nextMap.set(key, item)
    this.applyMap(nextMap)
  }

  /**
   * Upsert multiple items in one diff cycle.
   */
  setMany(items: T[]): void {
    let changed = false
    const nextMap = new Map(this._map)

    for (const item of items) {
      const key = this.getKey(item)
      if (nextMap.get(key) !== item) {
        nextMap.set(key, item)
        changed = true
      }
    }

    if (changed) this.applyMap(nextMap)
  }

  /**
   * Remove an item by key.
   */
  delete(key: Key): void {
    if (!this._map.has(key)) return
    const nextMap = new Map(this._map)
    nextMap.delete(key)
    this.applyMap(nextMap)
  }

  /**
   * Remove multiple items by key in one diff cycle.
   */
  deleteMany(keys: Key[]): void {
    const toDelete = keys.filter((k) => this._map.has(k))
    if (toDelete.length === 0) return
    const nextMap = new Map(this._map)
    for (const key of toDelete) nextMap.delete(key)
    this.applyMap(nextMap)
  }

  /**
   * Replace the entire collection. Equivalent to a reset if the overlap
   * with the current state falls below the threshold.
   */
  reset(items: T[]): void {
    const nextMap = new Map<Key, T>()
    for (const item of items) {
      nextMap.set(this.getKey(item), item)
    }
    this.applyMap(nextMap)
  }

  /**
   * Empty the collection.
   */
  clear(): void {
    if (this._map.size === 0) return
    this.applyMap(new Map())
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Register a callback to run when the store is destroyed. */
  onDestroy(fn: () => void): void {
    this.destroyCallbacks.add(fn)
  }

  destroy(): void {
    this.allSubscribers.clear()
    this.insertSubscribers.clear()
    this.removeSubscribers.clear()
    this.reorderSubscribers.clear()
    this.updateSubscribers.clear()
    this.resetSubscribers.clear()
    for (const cb of this.destroyCallbacks) cb()
    this.destroyCallbacks.clear()
  }

  // ─── Notification ──────────────────────────────────────────────────────────

  private notifyPatches(patches: Patch<T>[]): void {
    const currentItems = this.items // use cached array

    // Notify all-patch subscribers first
    for (const fn of this.allSubscribers) {
      fn(currentItems, patches)
    }

    // Notify targeted subscribers per patch type
    for (const patch of patches) {
      switch (patch.op) {
        case 'remove':
          for (const fn of this.removeSubscribers) fn(patch.keys)
          break

        case 'update':
          for (const fn of this.updateSubscribers) fn(patch.items)
          break

        case 'reorder':
          for (const fn of this.reorderSubscribers) fn(patch.keys)
          break

        case 'insert':
          if (this.insertSubscribers.size > 0) {
            const insertedItems = patch.items.map((i) => i.item)
            for (const fn of this.insertSubscribers) fn(insertedItems)
          }
          break

        case 'reset':
          for (const fn of this.resetSubscribers) fn(patch.items)
          break
      }
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCollectionStore<T>(
  options: CollectionStoreOptions<T>,
): CollectionStoreImpl<T> {
  return new CollectionStoreImpl(options)
}
