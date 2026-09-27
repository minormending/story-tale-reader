import { describe, it, expect } from 'vitest'
import { askForBookFile, bookHolders, type WindowClient } from './ask'
import type { BookFetchRequest, BookFetchResponse } from './protocol'

const IMAGE: BookFetchResponse = { ok: true, bytes: new ArrayBuffer(4), mimeType: 'image/jpeg' }

/** A window client that answers like the app's window, or, without an answer, like a page frame. */
function client(frameType: FrameType, answer?: BookFetchResponse): WindowClient & { asked: BookFetchRequest[] } {
  const asked: BookFetchRequest[] = []
  return {
    frameType,
    asked,
    postMessage(message, transfer) {
      asked.push(message as BookFetchRequest)
      const port = transfer[0] as MessagePort
      if (answer) port.postMessage(answer)
      port.close()
    },
  }
}

describe('bookHolders', () => {
  it('keeps only top-level windows: a book’s page frames can never answer', () => {
    const app = client('top-level')
    expect(bookHolders([client('nested'), app, client('nested')])).toEqual([app])
  })

  it('asks every window when none is top-level, as when the app is itself framed', () => {
    const framedApp = client('nested')
    const page = client('nested')
    expect(bookHolders([framedApp, page])).toEqual([framedApp, page])
  })
})

describe('askForBookFile', () => {
  it('asks the app, not the page that was just tapped and so is listed first', async () => {
    const tappedPage = client('nested')
    const app = client('top-level', IMAGE)
    const started = Date.now()
    const reply = await askForBookFile([tappedPage, app], 'book', 'images/00015.jpeg')
    expect(reply.ok).toBe(true)
    expect(tappedPage.asked).toEqual([])
    expect(app.asked).toEqual([{ type: 'vfs:read', bookId: 'book', path: 'images/00015.jpeg' }])
    // Not after a timeout: the page was never waited on.
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('moves on to the next window when one does not answer in time', async () => {
    const silent = client('top-level')
    const app = client('top-level', IMAGE)
    await expect(askForBookFile([silent, app], 'book', 'a.css', 20)).resolves.toEqual(IMAGE)
    expect(silent.asked).toHaveLength(1)
  })

  it('fails when no window answers, or there is none', async () => {
    await expect(askForBookFile([client('top-level')], 'book', 'a.css', 20)).rejects.toThrow('timed out')
    await expect(askForBookFile([], 'book', 'a.css')).rejects.toThrow('no window client')
  })
})
