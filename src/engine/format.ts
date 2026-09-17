/** Sniff a book's container format from its first bytes. */

import type { BookFormat } from './types'

export type DetectedFormat = BookFormat | 'unknown'

const ZIP = [0x50, 0x4b, 0x03, 0x04]
const PDF = [0x25, 0x50, 0x44, 0x46] // %PDF

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * PalmDB (MOBI/AZW3) carries its type and creator at offset 60. AZW3 files are
 * still BOOKMOBI containers — the KF8 part lives in a later record.
 */
function isPalmDoc(bytes: Uint8Array): boolean {
  const tag = new TextDecoder('latin1').decode(bytes.subarray(60, 68))
  return tag === 'BOOKMOBI' || tag === 'TEXtREAd'
}

export function detectFormat(head: Uint8Array): DetectedFormat {
  if (startsWith(head, PDF)) return 'pdf'
  if (startsWith(head, ZIP)) return 'epub'
  if (head.byteLength >= 68 && isPalmDoc(head)) return 'mobi'
  return 'unknown'
}

export async function detectBlobFormat(blob: Blob): Promise<DetectedFormat> {
  const head = new Uint8Array(await blob.slice(0, 128).arrayBuffer())
  return detectFormat(head)
}
