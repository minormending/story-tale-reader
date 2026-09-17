/** PalmDOC (LZ77) decompression, compression type 2. */

/**
 * The scheme is byte-oriented: literals pass through, 0x80-0xBF encodes a
 * back-reference, and 0xC0-0xFF encodes a space followed by one letter.
 */
export function decompressPalmDoc(input: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0

  while (i < input.byteLength) {
    const byte = input[i++]!

    if (byte === 0) {
      out.push(0)
    } else if (byte <= 8) {
      // Literal run: the next `byte` bytes are copied verbatim.
      for (let n = 0; n < byte && i < input.byteLength; n++) out.push(input[i++]!)
    } else if (byte <= 0x7f) {
      out.push(byte)
    } else if (byte <= 0xbf) {
      // Two-byte back-reference: 11 bits of distance, 3 bits of length.
      if (i >= input.byteLength) break
      const pair = (byte << 8) | input[i++]!
      const distance = (pair >> 3) & 0x07ff
      const length = (pair & 0x07) + 3
      if (distance === 0 || distance > out.length) continue
      const start = out.length - distance
      for (let n = 0; n < length; n++) out.push(out[start + n]!)
    } else {
      // A space plus the low seven bits as a character.
      out.push(0x20, byte ^ 0x80)
    }
  }

  return Uint8Array.from(out)
}
