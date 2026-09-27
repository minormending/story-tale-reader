import { describe, it, expect } from 'vitest'
import { deobfuscate, obfuscatedResources, obfuscationKey } from './obfuscation'

const ENCRYPTION = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>
    <enc:CipherData><enc:CipherReference URI="fonts/00001.ttf"/></enc:CipherData></enc:EncryptedData>
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData>
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/chapter.xhtml"/></enc:CipherData></enc:EncryptedData>
</encryption>`

/** The four bytes every TrueType font begins with. */
const SFNT = [0x00, 0x01, 0x00, 0x00]

describe('obfuscatedResources', () => {
  it('lists fonts under either scheme, by container path, and nothing else', () => {
    expect([...obfuscatedResources(ENCRYPTION)]).toEqual([
      ['fonts/00001.ttf', 'adobe'],
      ['OEBPS/fonts/a.otf', 'idpf'],
    ])
  })
})

describe('deobfuscate', () => {
  it('undoes Adobe obfuscation with the identifier’s UUID', async () => {
    const key = (await obfuscationKey('adobe', 'urn:uuid:6d0f120b-9c57-4ce4-8ad8-d8eb737c71cf'))!
    // What Calibre stored for a real font: its sfnt header, scrambled.
    const stored = Uint8Array.from([0x6d, 0x0e, 0x12, 0x0b, ...new Array(2000).fill(7)])
    const font = deobfuscate(stored, key, 'adobe')
    expect([...font.subarray(0, 4)]).toEqual(SFNT)
    // Only the first 1024 bytes were scrambled.
    expect(font[1500]).toBe(7)
  })

  it('undoes IDPF obfuscation with the SHA-1 of the identifier, spaces removed', async () => {
    const identifier = 'urn:uuid:1234 5678'
    const key = (await obfuscationKey('idpf', identifier))!
    expect(key).toHaveLength(20)
    const original = Uint8Array.from([...SFNT, ...new Array(1100).fill(1)])
    const stored = deobfuscate(original, key, 'idpf') // XOR is its own inverse
    expect([...deobfuscate(stored, (await obfuscationKey('idpf', 'urn:uuid:12345678'))!, 'idpf')]).toEqual([...original])
    expect(stored[1050]).toBe(1)
  })

  it('makes no Adobe key from an identifier that is not a UUID', async () => {
    expect(await obfuscationKey('adobe', 'isbn:9781484724569')).toBeUndefined()
  })
})
