/**
 * Turning what someone dropped or picked into a list of books.
 *
 * A folder of books is the normal way people keep them — a Calibre library, a
 * download folder, a card copied off an old tablet — and picking them one at a time
 * is the kind of chore that stops someone bothering at all.
 */

const BOOK_EXTENSIONS = /\.(epub|pdf|mobi|azw3|prc)$/i

/** Anything the reader can open, by name. Contents are sniffed later. */
export function isBookFile(file: File): boolean {
  return BOOK_EXTENSIONS.test(file.name)
}

/**
 * Every file under a dropped folder, recursively.
 *
 * `DataTransferItem.webkitGetAsEntry` is the only way to see inside a dropped
 * directory: `dataTransfer.files` lists the folder itself and nothing within it, so
 * dropping a folder without this reads as dropping zero books.
 *
 * The entries have to be taken from the list *synchronously*, before the first
 * await — `dataTransfer.items` is emptied once the drop event finishes, and reading
 * it after awaiting anything gives an empty list.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  // No entry API: fall back to the flat list, which is right for plain files.
  if (entries.length === 0) return Array.from(transfer.files).filter(isBookFile)

  const out: File[] = []
  for (const entry of entries) await collect(entry, out)
  return out.filter(isBookFile)
}

async function collect(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | undefined>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(undefined)),
    )
    if (file) out.push(file)
    return
  }
  if (!entry.isDirectory) return

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries returns at most a hundred or so per call and signals the end with an
  // empty batch, so one call is not enough for a real library folder.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    )
    if (batch.length === 0) return
    for (const child of batch) await collect(child, out)
  }
}

/**
 * Whether this browser can actually let someone choose a directory.
 *
 * Chrome for Android and Safari on iOS both ignore `webkitdirectory` and open an
 * ordinary file picker instead, so a button offering a folder there is a button
 * that lies — which is exactly what it did: "select a folder on Android does not
 * work, it prompts the user to select a file instead."
 *
 * The attribute cannot be asked. It is present in the IDL on mobile Chromium, and
 * setting it succeeds; only the picker declines to honour it, and it does so at the
 * point a person is looking at the wrong dialog. Nothing about the DOM reveals that
 * beforehand, so this asks what platform it is on — a last resort, used because
 * there is no first one.
 */
export function canPickDirectory(): boolean {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false
  if (!('webkitdirectory' in document.createElement('input'))) return false

  // Chromium states it outright; everything else has to be read off the UA string.
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (typeof hints?.mobile === 'boolean') return !hints.mobile

  // iPadOS reports itself as a Mac, so a touch-capable "Mac" is an iPad.
  const ua = navigator.userAgent
  if (/Android|iPhone|iPod/i.test(ua)) return false
  if (/iPad/i.test(ua)) return false
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return false
  return true
}
