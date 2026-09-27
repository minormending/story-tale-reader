/**
 * Font obfuscation: the scrambling EPUBs apply to embedded fonts so that they are
 * not casually lifted out of the book. Not DRM (ocf.ts lets such books through):
 * the key is the book's own identifier, and every reading system is meant to undo
 * it. Left undone, the fonts are rubbish to the browser, the text falls back to
 * some other face, and a fixed-layout page — whose lines were placed for the
 * book's own font — overflows its boxes.
 *
 * Two schemes are in use. The IDPF's XORs the first 1040 bytes with the SHA-1 of the
 * book's unique identifier. Adobe's, still written by Calibre, XORs the first 1024
 * with the sixteen bytes of the identifier's UUID.
 */

import { parseXml, findAll, attr } from '../xml'
import { dirname, resolvePath } from '../path'

export type Obfuscation = 'idpf' | 'adobe'

const ALGORITHMS: Record<string, Obfuscation> = {
  'http://www.idpf.org/2008/embedding': 'idpf',
  'http://ns.adobe.com/pdf/enc#RC': 'adobe',
}

const OBFUSCATED_BYTES: Record<Obfuscation, number> = { idpf: 1040, adobe: 1024 }

/** Container paths of obfuscated resources, from META-INF/encryption.xml. */
export function obfuscatedResources(encryptionXml: string): Map<string, Obfuscation> {
  const out = new Map<string, Obfuscation>()
  for (const data of findAll(parseXml(encryptionXml), 'EncryptedData')) {
    const method = findAll(data, 'EncryptionMethod')[0]
    const reference = findAll(data, 'CipherReference')[0]
    const kind = method ? ALGORITHMS[attr(method, 'Algorithm') ?? ''] : undefined
    const uri = reference ? attr(reference, 'URI') : undefined
    // URIs in encryption.xml are relative to the container root, not to META-INF.
    if (kind && uri) out.set(resolvePath(dirname(''), uri), kind)
  }
  return out
}

/** The key for a scheme, from the package's unique identifier; undefined when it cannot be made. */
export async function obfuscationKey(kind: Obfuscation, identifier: string): Promise<Uint8Array | undefined> {
  if (kind === 'adobe') {
    const hex = identifier.trim().replace(/^urn:uuid:/i, '').replace(/-/g, '')
    if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined
    return Uint8Array.from(hex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)))
  }
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  const text = identifier.replace(/[ \u0009\u000d\u000a]/g, '')
  return new Uint8Array(await subtle.digest('SHA-1', new TextEncoder().encode(text)))
}

/** Undo the obfuscation, returning a new array; the rest of the font is untouched. */
export function deobfuscate(bytes: Uint8Array, key: Uint8Array, kind: Obfuscation): Uint8Array {
  const out = bytes.slice()
  const count = Math.min(OBFUSCATED_BYTES[kind], out.length)
  for (let i = 0; i < count; i++) out[i] = out[i]! ^ key[i % key.length]!
  return out
}
