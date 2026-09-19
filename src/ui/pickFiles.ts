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
