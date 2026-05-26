/**
 * @overlive/stores/react
 *
 * React adapter for CollectionStore.
 * Requires React 18+ (useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react'
import type { CollectionStore } from '../collection/types.js'

/**
 * Subscribes a React component to a CollectionStore.
 * Returns the current items array — the component re-renders whenever
 * the store changes.
 *
 * @example
 * const messages = useCollectionStore(chatStore)
 * return <>{messages.map(msg => <div key={msg.id}>{msg.data.text}</div>)}</>
 */
export function useCollectionStore<T>(store: CollectionStore<T>): T[] {
  return useSyncExternalStore(
    // subscribe — React calls this to register its own re-render trigger
    (onStoreChange) => store.subscribe((_items, _patches) => onStoreChange()),
    // getSnapshot — React calls this to read the current value
    () => store.items,
  )
}
