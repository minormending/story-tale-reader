import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { contractJson, describeBook } from './contract'

/**
 * The contract the Android engine is held to (see contract.ts).
 *
 *   npm test                   checks corpus/expected/ is what the engine produces now
 *   npm run contract           rewrites corpus/expected/ after a deliberate change
 *
 * A failure here after an engine change is not necessarily a bug: it means the
 * output moved, and the Kotlin port will need to move with it. Rewrite the files,
 * read the diff, and commit them with the change that caused them.
 *
 * Books that cannot be committed — the real ones in corpus/local/, or a tablet's
 * worth pulled by the Android lab — get the same treatment, written next to them:
 *
 *   CONTRACT_BOOKS=path/to/books npm run contract
 *
 * writes path/to/books/.expected/<file>.json for every EPUB and MOBI in the folder.
 */

const FIXTURES = 'corpus/fixtures'
const EXPECTED = 'corpus/expected'
const BOOK = /\.(epub|mobi|azw3?)$/i

const update = process.env.UPDATE_CONTRACT === '1'
const external = process.env.CONTRACT_BOOKS

const books = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((name) => BOOK.test(name)).sort() : []

async function contractFor(path: string): Promise<string> {
  return contractJson(await describeBook(new Uint8Array(readFileSync(path)), basename(path)))
}

describe.skipIf(Boolean(external))('engine contract: committed fixtures', () => {
  const fixtures = books(FIXTURES)

  it.each(fixtures)('%s', { timeout: 60_000 }, async (name) => {
    const actual = await contractFor(join(FIXTURES, name))
    const target = join(EXPECTED, `${name}.json`)
    if (update) {
      mkdirSync(EXPECTED, { recursive: true })
      writeFileSync(target, actual)
      return
    }
    expect(existsSync(target), `${target} is missing — run npm run contract`).toBe(true)
    expect(actual, `${target} is stale — run npm run contract and commit the diff`).toBe(
      readFileSync(target, 'utf8'),
    )
  })

  it('has no expected output for a fixture that no longer exists', () => {
    const expected = existsSync(EXPECTED)
      ? readdirSync(EXPECTED).filter((name) => name.endsWith('.json'))
      : []
    const stale = expected.filter((name) => !fixtures.includes(name.replace(/\.json$/, '')))
    expect(stale).toEqual([])
  })
})

describe.skipIf(!external)('engine contract: an outside folder of books', () => {
  const dir = external ?? ''
  const out = process.env.CONTRACT_OUT ?? join(dir, '.expected')

  it.each(books(dir))('%s', { timeout: 300_000 }, async (name) => {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `${name}.json`), await contractFor(join(dir, name)))
  })
})
