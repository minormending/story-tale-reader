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
    load: async () => {
      const { path } = await plugin.read({ uri: book.uri })
      return readNativeCopy(path, book.name, (copy) => plugin.discard({ path: copy }))
    },
  }))
}
