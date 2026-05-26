/**
 * @overlive/stores/vue
 *
 * Vue 3 adapter for CollectionStore.
 */
import { shallowRef, onUnmounted, type ShallowRef } from 'vue'
import type { CollectionStore } from '../collection/types.js'

/**
 * Subscribes a Vue component to a CollectionStore.
 * Returns a shallow ref containing the current items array.
 * Automatically unsubscribes when the component is unmounted.
 *
 * Uses shallowRef intentionally — the store's item references are stable
 * for unchanged entries, so deep reactivity would add overhead for no gain.
 * If you need deep reactivity on individual items, wrap them yourself.
 *
 * @example
 * const messages = useCollectionStore(chatStore)
 * // in template: v-for="msg in messages"
 */
export function useCollectionStore<T>(store: CollectionStore<T>): ShallowRef<T[]> {
  const ref = shallowRef<T[]>(store.items)

  const unsub = store.subscribe((items) => {
    ref.value = items
  })

  onUnmounted(unsub)

  return ref
}
