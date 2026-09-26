/**
 * Bridge to the Android FolderPicker plugin.
 *
 * `<input webkitdirectory>` is ignored by Chrome for Android — it opens an ordinary
 * file picker — so the browser cannot offer a folder at all. Inside the APK the
 * Storage Access Framework can, and this is the way to it. A no-op on the web,
 * where the shelf falls back to picking several files at once.
 */

import { registerPlugin } from '@capacitor/core'
import { isNative } from './bookIntent'
import { readNativeCopy } from './nativeCopy'

interface PickedBook {
  uri: string
  name: string
  size: number
}

interface FolderPickerPlugin {
  pick(): Promise<{ cancelled: boolean; books: PickedBook[] }>
  read(options: { uri: string }): Promise<{ path: string; size: number }>
  discard(options: { path: string }): Promise<void>
  downloadsAccess(): Promise<{ needsPermission: boolean; granted: boolean }>
  requestDownloadsAccess(): Promise<{ granted: boolean }>
  scanDownloads(): Promise<{ books: Array<{ path: string; name: string; size: number }> }>
}

const plugin = registerPlugin<FolderPickerPlugin>('FolderPicker')

/**
 * A book the reader has chosen but not yet paid for.
 *
 * The bytes are fetched when the import reaches this book, not when the folder is
 * chosen: forty picture books in memory at once is an out-of-memory kill on the
 * tablets this is for, and most of a folder is waiting its turn at any moment.
 */
export interface BookSource {
  name: string
  /** Bytes, where known before loading: with the name, how a book already on the shelf is recognised. */
  size?: number
  load: () => Promise<File>
}

/** Whether a real folder can be chosen here. Only inside the APK. */
export function canPickFolderNatively(): boolean {
  return isNative()
}

/**
 * Ask for a folder and list the books in it.
 *
 * `undefined` means the reader backed out, which is not an error and should leave
 * the shelf exactly as it was.
 */
export async function pickFolder(): Promise<BookSource[] | undefined> {
  if (!isNative()) return undefined

  const result = await plugin.pick()
  if (result.cancelled) return undefined

  return result.books.map((book) => ({
    name: book.name,
    size: book.size,
    load: async () => {
      const { path } = await plugin.read({ uri: book.uri })
      return readNativeCopy(path, book.name, (copy) => plugin.discard({ path: copy }))
    },
  }))
}

/* -------------------------------- Downloads -------------------------------- */

/**
 * Whether Downloads needs "All files access" here, and whether it has it.
 *
 * Since Android 11 the folder picker refuses Downloads itself — "to protect your
 * privacy, choose another folder" — so on those versions it is offered separately,
 * and read with a permission the reader grants in Android's settings. Older
 * versions still let the picker choose it, so nothing extra is offered there.
 */
export async function downloadsAccess(): Promise<{ needsPermission: boolean; granted: boolean }> {
  if (!isNative()) return { needsPermission: false, granted: false }
  return plugin.downloadsAccess()
}

/** Takes the reader to Android's "All files access" screen; true if they turned it on. */
export async function requestDownloadsAccess(): Promise<boolean> {
  return (await plugin.requestDownloadsAccess()).granted
}

/**
 * The books in Downloads and the folders inside it.
 *
 * Each is fetched straight from where it lies when the import reaches it. There is
 * no copy to discard afterwards — the file is the reader's own and stays put.
 */
export async function listDownloads(): Promise<BookSource[]> {
  const { books } = await plugin.scanDownloads()
  return books.map((book) => ({
    name: book.name,
    size: book.size,
    load: () => readNativeCopy(book.path, book.name, async () => undefined),
  }))
}
