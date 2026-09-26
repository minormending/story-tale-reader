import { describe, expect, it } from 'vitest'
import { latestOnly } from './latest'

interface Position {
  page: number
}

function recorder() {
  const writes: Array<[string, number]> = []
  let release: (() => void) | undefined
  let gate = Promise.resolve()
  const write = async (key: string, value: Position) => {
    await gate
    writes.push([key, value.page])
  }
  return {
    writes,
    write,
    hold() {
      gate = new Promise((resolve) => (release = resolve))
    },
    release() {
      release?.()
      gate = Promise.resolve()
    },
  }
}

const same = (a: Position, b: Position) => a.page === b.page

describe('latestOnly', () => {
  it('writes a value', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    await save('book', { page: 1 })
    expect(r.writes).toEqual([['book', 1]])
  })

  it('skips a value equal to the one last written', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    await save('book', { page: 1 })
    await save('book', { page: 1 })
    expect(r.writes).toEqual([['book', 1]])
  })

  it('collapses a burst into the first and the last, however long the burst', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    r.hold()
    const pending: Promise<void>[] = []
    for (let page = 1; page <= 500; page++) pending.push(save('book', { page }))
    r.release()
    await Promise.all(pending)
    expect(r.writes).toEqual([
      ['book', 1],
      ['book', 500],
    ])
  })

  it('keeps separate books separate', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    await Promise.all([save('a', { page: 3 }), save('b', { page: 7 })])
    expect(r.writes.sort()).toEqual([
      ['a', 3],
      ['b', 7],
    ])
  })

  it('always ends on the last value sent, even one arriving mid-write', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    await save('book', { page: 4 })
    r.hold()
    const first = save('book', { page: 5 })
    const second = save('book', { page: 4 })
    r.release()
    await Promise.all([first, second])
    expect(r.writes.at(-1)).toEqual(['book', 4])
    expect(r.writes).toHaveLength(3)
  })

  it('drops values superseded before their write begins', async () => {
    const r = recorder()
    const save = latestOnly(r.write, same)
    r.hold()
    const first = save('book', { page: 1 })
    const middle = save('book', { page: 2 })
    const last = save('book', { page: 1 })
    r.release()
    await Promise.all([first, middle, last])
    // 1 was already being written; 2 was replaced by 1 before it started, and 1 is
    // what was last written, so nothing further goes out.
    expect(r.writes).toEqual([['book', 1]])
  })

  it('recovers after a failed write', async () => {
    let fail = true
    const writes: number[] = []
    const save = latestOnly(async (_key, value: Position) => {
      if (fail) throw new Error('quota')
      writes.push(value.page)
    }, same)
    await expect(save('book', { page: 1 })).rejects.toThrow('quota')
    fail = false
    await save('book', { page: 2 })
    expect(writes).toEqual([2])
  })
})
