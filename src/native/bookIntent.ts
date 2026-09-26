/**
 * Bridge to the Android BookIntent plugin: books opened from a file manager's
 * "Open with" or the share sheet. A no-op on the web.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { readNativeCopy } from './nativeCopy'

interface IncomingBook {
  available: boolean
  name?: string
  /** Where native code copied the book, in the app's cache. */
  path?: string
  size?: number
}

interface BookIntentPlugin {
  take(): Promise<IncomingBook>
  discard(options: { path: string }): Promise<void>
  addListener(eventName: 'bookOpened', listener: () => void): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<BookIntentPlugin>('BookIntent')

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Collect a book handed to the app by another app, if one is waiting.
 *
 * Rejects when the book could not be collected, with a message meant for the
 * reader. It used to swallow that, so a book that failed to arrive — every large
 * one, back when it crossed the bridge as base64 — made "Open with" do nothing.
 */
export async function takeIncomingBook(): Promise<File | undefined> {
  if (!isNative()) return undefined

  const result = await plugin.take()
  if (!result.available || !result.path || !result.name) return undefined
  return readNativeCopy(result.path, result.name, (path) => plugin.discard({ path }))
}

export async function onBookOpened(listener: () => void): Promise<PluginListenerHandle | undefined> {
  if (!isNative()) return undefined
  return plugin.addListener('bookOpened', listener)
}
