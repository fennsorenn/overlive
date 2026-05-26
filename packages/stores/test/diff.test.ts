import { describe, it, expect } from 'vitest'
import { diff } from '../src/collection/diff.js'
import type { Key } from '../src/collection/types.js'

const eq = <T>(a: T, b: T) => a === b

function makeMap<T>(entries: Array<[Key, T]>): Map<Key, T> {
  return new Map(entries)
}

describe('diff', () => {

  // ─── Reset threshold ────────────────────────────────────────────────────────

  it('emits reset when overlap is below threshold', () => {
    const prev = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const next = makeMap([['x', 10], ['y', 20]])
    const patches = diff(prev, next, eq, 0.5)
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe('reset')
  })

  it('does not reset when overlap meets threshold', () => {
    const prev = makeMap([['a', 1], ['b', 2]])
    const next = makeMap([['a', 1], ['b', 99]])
    const patches = diff(prev, next, eq, 0.5)
    expect(patches.every(p => p.op !== 'reset')).toBe(true)
  })

  it('empty → empty produces no patches', () => {
    expect(diff(new Map(), new Map(), eq)).toHaveLength(0)
  })

  it('empty → populated produces insert', () => {
    const next = makeMap([['a', 1], ['b', 2]])
    const patches = diff(new Map(), next, eq, 0.5)
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe('insert')
  })

  it('populated → empty produces reset (clear)', () => {
    const prev = makeMap([['a', 1], ['b', 2]])
    const patches = diff(prev, new Map(), eq, 0.5)
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe('reset')
    if (patches[0]!.op === 'reset') {
      expect(patches[0].items).toHaveLength(0)
    }
  })

  // ─── Remove ─────────────────────────────────────────────────────────────────

  it('detects removed keys', () => {
    const prev = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const next = makeMap([['a', 1], ['c', 3]])
    const patches = diff(prev, next, eq, 0)
    const remove = patches.find(p => p.op === 'remove')
    expect(remove).toBeDefined()
    if (remove?.op === 'remove') {
      expect(remove.keys).toEqual(['b'])
    }
  })

  it('detects multiple removed keys', () => {
    const prev = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const next = makeMap([['b', 2]])
    const patches = diff(prev, next, eq, 0)
    const remove = patches.find(p => p.op === 'remove')
    expect(remove?.op === 'remove' && remove.keys).toEqual(expect.arrayContaining(['a', 'c']))
  })

  // ─── Update ──────────────────────────────────────────────────────────────────

  it('detects updated values (different reference)', () => {
    const prev = makeMap([['a', { v: 1 }], ['b', { v: 2 }]])
    const bNew = { v: 99 }
    const next = makeMap([['a', prev.get('a')!], ['b', bNew]])
    const patches = diff(prev, next, eq, 0)
    const update = patches.find(p => p.op === 'update')
    expect(update?.op === 'update' && update.items).toEqual([{ key: 'b', value: bNew }])
  })

  it('does not emit update for same reference', () => {
    const obj = { v: 1 }
    const prev = makeMap([['a', obj]])
    const next = makeMap([['a', obj]])
    const patches = diff(prev, next, eq, 0)
    expect(patches.find(p => p.op === 'update')).toBeUndefined()
  })

  it('respects custom equals function', () => {
    const deepEq = (a: { v: number }, b: { v: number }) => a.v === b.v
    const prev = makeMap([['a', { v: 1 }]])
    const next = makeMap([['a', { v: 1 }]]) // new ref, same value
    const patches = diff(prev, next, deepEq as any, 0)
    expect(patches.find(p => p.op === 'update')).toBeUndefined()
  })

  // ─── Reorder ─────────────────────────────────────────────────────────────────

  it('detects reorder of surviving keys', () => {
    const prev = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const next = makeMap([['c', 3], ['a', 1], ['b', 2]])
    const patches = diff(prev, next, eq, 0)
    const reorder = patches.find(p => p.op === 'reorder')
    expect(reorder?.op === 'reorder' && reorder.keys).toEqual(['c', 'a', 'b'])
  })

  it('does not emit reorder when order is unchanged', () => {
    const prev = makeMap([['a', 1], ['b', 2]])
    const next = makeMap([['a', 1], ['b', 99]]) // value changed, order same
    const patches = diff(prev, next, eq, 0)
    expect(patches.find(p => p.op === 'reorder')).toBeUndefined()
  })

  // ─── Insert ──────────────────────────────────────────────────────────────────

  it('detects appended item with correct index', () => {
    const prev = makeMap([['a', 1], ['b', 2]])
    const next = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const patches = diff(prev, next, eq, 0)
    const insert = patches.find(p => p.op === 'insert')
    expect(insert?.op === 'insert' && insert.items).toEqual([{ item: 3, index: 2 }])
  })

  it('detects prepended item with index 0', () => {
    const prev = makeMap([['b', 2], ['c', 3]])
    const next = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const patches = diff(prev, next, eq, 0)
    const insert = patches.find(p => p.op === 'insert')
    expect(insert?.op === 'insert' && insert.items).toEqual([{ item: 1, index: 0 }])
  })

  it('detects multiple inserts at different indices', () => {
    const prev = makeMap([['b', 2]])
    const next = makeMap([['a', 1], ['b', 2], ['c', 3]])
    const patches = diff(prev, next, eq, 0)
    const insert = patches.find(p => p.op === 'insert')
    expect(insert?.op === 'insert' && insert.items).toEqual(
      expect.arrayContaining([{ item: 1, index: 0 }, { item: 3, index: 2 }])
    )
  })

  // ─── Patch ordering ──────────────────────────────────────────────────────────

  it('emits patches in remove → update → reorder → insert order', () => {
    const aObj = { v: 1 }
    const bObj = { v: 2 }
    const bNew = { v: 99 }
    const prev = makeMap([['a', aObj], ['b', bObj], ['c', { v: 3 }]])
    // remove c, update b, reorder a↔b, insert d
    const next = makeMap([['b', bNew], ['a', aObj], ['d', { v: 4 }]])

    const patches = diff(prev, next, eq, 0)
    const ops = patches.map(p => p.op)

    const removeIdx  = ops.indexOf('remove')
    const updateIdx  = ops.indexOf('update')
    const reorderIdx = ops.indexOf('reorder')
    const insertIdx  = ops.indexOf('insert')

    expect(removeIdx).toBeLessThan(updateIdx)
    expect(updateIdx).toBeLessThan(reorderIdx)
    expect(reorderIdx).toBeLessThan(insertIdx)
  })

  // ─── No spurious patches ─────────────────────────────────────────────────────

  it('produces no patches when state is identical', () => {
    const obj = { v: 1 }
    const map = makeMap([['a', obj], ['b', { v: 2 }]])
    // same references, same order
    const next = makeMap([...map.entries()])
    const patches = diff(map, next, eq, 0)
    // only update could fire (for non-identical refs), b has a new ref here
    // but we didn't change b so let's use same refs
    expect(patches.filter(p => p.op !== 'update' || (p.op === 'update' && p.items.length > 0))).toHaveLength(0)
  })
})
