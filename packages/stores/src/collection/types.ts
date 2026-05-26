// ─── Keys ────────────────────────────────────────────────────────────────────

export type Key = string | number

// ─── Patch types ──────────────────────────────────────────────────────────────

/**
 * Describes a structural change to a collection.
 * Patches are emitted in this order per diff cycle:
 *   remove → update → reorder → insert
 *
 * Each step operates on the result of the previous, so applying patches
 * in order always yields a consistent intermediate state.
 */

export interface RemovePatch {
  op: 'remove'
  keys: Key[]
}

export interface UpdatePatch<T> {
  op: 'update'
  items: Array<{ key: Key; value: T }>
}

/** Describes the new order of surviving keys after removes and updates. */
export interface ReorderPatch {
  op: 'reorder'
  /** Full ordered list of surviving keys in their new positions */
  keys: Key[]
}

export interface InsertPatch<T> {
  op: 'insert'
  items: Array<{ item: T; index: number }>
}

/**
 * Emitted when the overlap between old and new state falls below the
 * reset threshold — cheaper to replace everything than describe the diff.
 * An empty reset is equivalent to clear.
 */
export interface ResetPatch<T> {
  op: 'reset'
  items: T[]
}

export type Patch<T> =
  | RemovePatch
  | UpdatePatch<T>
  | ReorderPatch
  | InsertPatch<T>
  | ResetPatch<T>

// ─── Subscriber types ─────────────────────────────────────────────────────────

export type Unsubscribe = () => void

export type CollectionSubscriber<T> = (
  items: T[],
  patches: Patch<T>[],
) => void

export type AppendSubscriber<T> = (items: T[]) => void
export type RemoveSubscriber = (keys: Key[]) => void
export type ReorderSubscriber = (keys: Key[]) => void
export type UpdateSubscriber<T> = (items: Array<{ key: Key; value: T }>) => void
export type ResetSubscriber<T> = (items: T[]) => void

// ─── Store interface ──────────────────────────────────────────────────────────

export interface CollectionStore<T> {
  /** Current items as an ordered array */
  readonly items: T[]

  /** Current items as a key→value map */
  readonly map: ReadonlyMap<Key, T>

  /**
   * Subscribe to all changes. Receives the full current array and
   * the patches that produced this state from the previous one.
   * Returns an unsubscribe function.
   */
  subscribe(fn: CollectionSubscriber<T>): Unsubscribe

  /**
   * Subscribe only to insertions. Fires when new items are added.
   * Receives the newly inserted items in insertion order.
   */
  onInsert(fn: AppendSubscriber<T>): Unsubscribe

  /**
   * Subscribe only to removals.
   */
  onRemove(fn: RemoveSubscriber): Unsubscribe

  /**
   * Subscribe only to reorders. Receives the new key order of
   * surviving items (does not include newly inserted items).
   */
  onReorder(fn: ReorderSubscriber): Unsubscribe

  /**
   * Subscribe only to value updates on existing keys.
   */
  onUpdate(fn: UpdateSubscriber<T>): Unsubscribe

  /**
   * Subscribe only to resets (including clears).
   */
  onReset(fn: ResetSubscriber<T>): Unsubscribe

  /**
   * Destroy the store — unsubscribes all listeners and releases resources.
   */
  destroy(): void
}

// ─── Store options ────────────────────────────────────────────────────────────

export interface CollectionStoreOptions<T> {
  /**
   * Key extractor — maps each item to a stable unique identifier.
   * Required for diffing to work correctly.
   */
  getKey: (item: T) => Key

  /**
   * Equality check for values at the same key.
   * Defaults to reference equality (===).
   *
   * Only useful if you produce entirely new references on every update
   * and want to suppress notifications for semantically unchanged values.
   * If you only recreate modified items (recommended), reference equality
   * is already optimal.
   */
  equals?: (a: T, b: T) => boolean

  /**
   * Fraction of keys that must overlap between old and new state before
   * a reset is emitted instead of individual patches.
   * Range: 0–1. Default: 0.5
   */
  resetThreshold?: number

  /** Initial items to populate the store with. */
  initialItems?: T[]
}
