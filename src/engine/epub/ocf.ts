/** OCF: the EPUB container layer (META-INF). */

import { parseXml, findAll, attr } from '../xml'
import type { ZipArchive } from '../zip/reader'

export class DrmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DrmError'
  }
}

const PACKAGE_MEDIA_TYPE = 'application/oebps-package+xml'

/**
 * Locate the package document. Per OCF the path comes from META-INF/container.xml;
 * a handful of broken files omit it, so fall back to finding a .opf in the archive.
 */
export function findPackagePath(containerXml: string): string | undefined {
  const doc = parseXml(containerXml)
  const rootfiles = findAll(doc, 'rootfile')
  const typed = rootfiles.find((r) => attr(r, 'media-type') === PACKAGE_MEDIA_TYPE)
  const chosen = typed ?? rootfiles[0]
  const path = chosen ? attr(chosen, 'full-path') : undefined
  return path ? path.replace(/^\//, '') : undefined
}

/**
 * Reject encrypted books at import rather than rendering garbage.
 *
 * META-INF/encryption.xml is also used for legitimate font obfuscation, which is
 * not DRM — only treat it as DRM when something other than a font is encrypted,
 * or when a known DRM artefact is present (SPEC.md §12).
 */
export async function detectDrm(archive: ZipArchive): Promise<string | undefined> {
  if (archive.has('META-INF/rights.xml')) return 'Adobe ADEPT'
  if (archive.has('META-INF/license.lcpl')) return 'Readium LCP'

  if (!archive.has('META-INF/encryption.xml')) return undefined

  const doc = parseXml(await archive.readText('META-INF/encryption.xml'))
  const targets = findAll(doc, 'CipherReference')
    .map((ref) => attr(ref, 'URI') ?? '')
    .filter(Boolean)

  const fontOnly = targets.every((uri) => /\.(woff2?|ttf|otf)$/i.test(uri))
  if (targets.length > 0 && fontOnly) return undefined

  const algorithms = findAll(doc, 'EncryptionMethod').map((m) => attr(m, 'Algorithm') ?? '')
  const obfuscationOnly =
    algorithms.length > 0 &&
    algorithms.every((a) => a.includes('embedding') || a.includes('idpf') || a.includes('adobe.com/apsfont'))
  if (obfuscationOnly) return undefined

  return 'unknown encryption'
}
