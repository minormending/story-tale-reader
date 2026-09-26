/**
 * Reading a book that native code has copied into the app's cache.
 *
 * Books from outside the web layer ("Open with", the share sheet, a picked folder)
 * are streamed to a file by the Android side and fetched here through Capacitor's
 * local server, rather than passed across the bridge as a base64 string — which
 * needed the whole book several times over in the Java heap and failed outright
 * above about 40 MB on the tablets this reader is for.
 */

import { Capacitor } from '@capacitor/core'

export async function readNativeCopy(
  path: string,
  name: string,
  discard: (path: string) => Promise<unknown>,
): Promise<File> {
  try {
    const response = await fetch(Capacitor.convertFileSrc(path))
    if (!response.ok) throw new Error(`Could not read that book (HTTP ${response.status})`)
    return new File([await response.blob()], name)
  } finally {
    // The blob is the browser's own copy now; the cached file can go.
    void discard(path).catch(() => undefined)
  }
}
