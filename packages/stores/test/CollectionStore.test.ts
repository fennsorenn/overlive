import { describe, it, expect, vi } from 'vitest'
import { createCollectionStore } from '../src/collection/CollectionStore.js'

interface Item {
  id: string
  value: number
}

function makeStore(items: Item[] = []) {
  return createCollectionStore<Item>({
    getKey: (item) => item.id,
    initialItems: items,
    resetThreshold: 0.5,
  })
}

describe('CollectionStore', () => {

  it('initialises with items', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    expect(store.items).toHaveLength(1)
    expect(store.items[0]!.id).toBe('a')
  })

  it('set adds a new item and notifies onInsert', () => {
    const store = makeStore()
    const onInsert = vi.fn()
    store.onInsert(onInsert)
    store.set({ id: 'a', value: 1 })
    expect(onInsert).toHaveBeenCalledWith([{ id: 'a', value: 1 }])
  })

  it('set with same reference does not notify', () => {
    const item = { id: 'a', value: 1 }
    const store = makeStore([item])
    const sub = vi.fn()
    store.subscribe(sub)
    store.set(item) // same ref
    expect(sub).not.toHaveBeenCalled()
  })

  it('set with new reference notifies onUpdate', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    const onUpdate = vi.fn()
    store.onUpdate(onUpdate)
    store.set({ id: 'a', value: 99 }) // new ref, same key
    expect(onUpdate).toHaveBeenCalledWith([{ key: 'a', value: { id: 'a', value: 99 } }])
  })

  it('delete removes an item and notifies onRemove', () => {
    const store = makeStore([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    const onRemove = vi.fn()
    store.onRemove(onRemove)
    store.delete('a')
    expect(onRemove).toHaveBeenCalledWith(['a'])
    expect(store.items).toHaveLength(1)
  })

  it('delete of non-existent key does nothing', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    const sub = vi.fn()
    store.subscribe(sub)
    store.delete('nonexistent')
    expect(sub).not.toHaveBeenCalled()
  })

  it('setMany batches inserts into one diff cycle', () => {
    const store = makeStore()
    const sub = vi.fn()
    store.subscribe(sub)
    store.setMany([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    expect(sub).toHaveBeenCalledOnce()
    expect(store.items).toHaveLength(2)
  })

  it('clear emits reset with empty array', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    const onReset = vi.fn()
    store.onReset(onReset)
    store.clear()
    expect(onReset).toHaveBeenCalledWith([])
    expect(store.items).toHaveLength(0)
  })

  it('clear on already-empty store does nothing', () => {
    const store = makeStore()
    const sub = vi.fn()
    store.subscribe(sub)
    store.clear()
    expect(sub).not.toHaveBeenCalled()
  })

  it('reset replaces the full collection', () => {
    const store = makeStore([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    const onReset = vi.fn()
    store.onReset(onReset)
    store.reset([{ id: 'x', value: 10 }])
    expect(onReset).toHaveBeenCalled()
    expect(store.items).toHaveLength(1)
    expect(store.items[0]!.id).toBe('x')
  })

  it('reorder fires onReorder when item order changes', () => {
    const store = makeStore([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])
    const onReorder = vi.fn()
    store.onReorder(onReorder)
    // apply a new map with reversed order
    const nextMap = new Map([
      ['b', store.map.get('b')!],
      ['a', store.map.get('a')!],
    ])
    store.applyMap(nextMap)
    expect(onReorder).toHaveBeenCalledWith(['b', 'a'])
  })

  it('items array is cached between reads', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    expect(store.items).toBe(store.items) // same reference
  })

  it('items cache is invalidated after mutation', () => {
    const store = makeStore([{ id: 'a', value: 1 }])
    const before = store.items
    store.set({ id: 'b', value: 2 })
    expect(store.items).not.toBe(before)
  })

  it('unsubscribe stops notifications', () => {
    const store = makeStore()
    const fn = vi.fn()
    const unsub = store.subscribe(fn)
    unsub()
    store.set({ id: 'a', value: 1 })
    expect(fn).not.toHaveBeenCalled()
  })

  it('destroy clears all subscribers and calls destroy callbacks', () => {
    const store = makeStore()
    const sub = vi.fn()
    const onDestroyed = vi.fn()
    store.subscribe(sub)
    store.onDestroy(onDestroyed)
    store.destroy()
    store.set({ id: 'a', value: 1 })
    expect(sub).not.toHaveBeenCalled()
    expect(onDestroyed).toHaveBeenCalledOnce()
  })
})
