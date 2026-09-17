/**
 * Bridge to the Android BookIntent plugin: books opened from a file manager's
 * "Open with" or the share sheet. A no-op on the web.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface IncomingBook {
  available: boolean
  name?: string
  data?: string
}

interface BookIntentPlugin {
  take(): Promise<IncomingBook>
  addListener(eventName: 'bookOpened', listener: () => void): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<BookIntentPlugin>('BookIntent')

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Collect a book handed to the app by another app, if one is waiting. */
export async function takeIncomingBook(): Promise<File | undefined> {
  if (!isNative()) return undefined

  const result = await plugin.take().catch(() => undefined)
  if (!result?.available || !result.data || !result.name) return undefined

  // Decoded through a data: URL rather than atob and a manual byte loop — the
  // browser's own decoder is dramatically faster across tens of megabytes.
  const response = await fetch(`data:application/octet-stream;base64,${result.data}`)
  return new File([await response.blob()], result.name)
}

export async function onBookOpened(listener: () => void): Promise<PluginListenerHandle | undefined> {
  if (!isNative()) return undefined
  return plugin.addListener('bookOpened', listener)
}
