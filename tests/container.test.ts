import { describe, expect, it } from 'vitest'
import { concatBytes, randomBytes, randomId } from '../src/crypto/bytes'
import {
  CHUNK_OVERHEAD,
  DEFAULT_CHUNK_SIZE,
  decryptBytes,
  encryptBytes,
  importMasterKey,
  readHeader,
  bytesSource,
} from '../src/crypto/container'
import { FormatError, IntegrityError } from '../src/crypto/errors'

const MiB = 1024 * 1024

async function newMk() {
  return importMasterKey(randomBytes(32))
}

function patterned(size: number): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 8)) & 0xff
  return out
}

describe('VDV1 container round trips', () => {
  const sizes: [string, number, number][] = [
    ['empty file', 0, 1],
    ['1 byte', 1, 1],
    ['exactly 4 MiB', 4 * MiB, 1],
    ['4 MiB + 1', 4 * MiB + 1, 2],
    ['50 MiB', 50 * MiB, 13],
  ]
  for (const [name, size, chunks] of sizes) {
    it(`${name} (${chunks} chunk${chunks > 1 ? 's' : ''})`, async () => {
      const mk = await newMk()
      const id = randomId()
      const plain = patterned(size)
      const enc = await encryptBytes(mk, id, 'file', plain)
      const { header, dataOffset } = await readHeader(bytesSource(enc))
      expect(header).toMatchObject({ v: 1, kind: 'file', id, size, chunkCount: chunks })
      expect(header.chunkSize).toBe(DEFAULT_CHUNK_SIZE)
      expect(enc.length).toBe(dataOffset + size + chunks * CHUNK_OVERHEAD)
      const dec = await decryptBytes(mk, enc, { expectedId: id, expectedKind: 'file' })
      expect(dec.length).toBe(size)
      expect(Buffer.from(dec).equals(Buffer.from(plain))).toBe(true)
    })
  }

  it('never stores metadata in the clear', async () => {
    const mk = await newMk()
    const enc = await encryptBytes(
      mk,
      randomId(),
      'entry',
      new TextEncoder().encode('secret title'),
    )
    expect(Buffer.from(enc).includes('secret')).toBe(false)
  })
})

describe('VDV1 container rejects damage', () => {
  // 3 chunks of 1 KiB so chunks can be swapped without changing lengths.
  const chunkSize = 1024
  async function sample() {
    const mk = await newMk()
    const id = randomId()
    const plain = patterned(3 * chunkSize)
    const enc = await encryptBytes(mk, id, 'file', plain, chunkSize)
    const { dataOffset } = await readHeader(bytesSource(enc))
    const stride = chunkSize + CHUNK_OVERHEAD
    return { mk, id, enc, dataOffset, stride }
  }

  it('fails on a tampered chunk byte', async () => {
    const { mk, enc, dataOffset, stride } = await sample()
    enc[dataOffset + stride + 40] ^= 0x01
    await expect(decryptBytes(mk, enc)).rejects.toThrow(IntegrityError)
    await expect(decryptBytes(mk, enc)).rejects.toThrow(/Chunk 1 failed authentication/)
  })

  it('fails on a tampered IV or tag', async () => {
    const { mk, enc, dataOffset, stride } = await sample()
    const a = enc.slice()
    a[dataOffset] ^= 0x80
    await expect(decryptBytes(mk, a)).rejects.toThrow(IntegrityError)
    const b = enc.slice()
    b[dataOffset + stride - 1] ^= 0x80
    await expect(decryptBytes(mk, b)).rejects.toThrow(IntegrityError)
  })

  it('fails on reordered chunks', async () => {
    const { mk, enc, dataOffset, stride } = await sample()
    const c0 = enc.slice(dataOffset, dataOffset + stride)
    const c1 = enc.slice(dataOffset + stride, dataOffset + 2 * stride)
    const swapped = concatBytes(
      enc.subarray(0, dataOffset),
      c1,
      c0,
      enc.subarray(dataOffset + 2 * stride),
    )
    expect(swapped.length).toBe(enc.length)
    await expect(decryptBytes(mk, swapped)).rejects.toThrow(/Chunk 0 failed authentication/)
  })

  it('fails on a truncated file (last chunk dropped)', async () => {
    const { mk, enc, stride } = await sample()
    await expect(decryptBytes(mk, enc.subarray(0, enc.length - stride))).rejects.toThrow(
      FormatError,
    )
    await expect(decryptBytes(mk, enc.subarray(0, enc.length - 1))).rejects.toThrow(/truncated/)
  })

  it('fails when the header is edited to hide the dropped last chunk', async () => {
    const { mk, enc, dataOffset, stride } = await sample()
    const { header } = await readHeader(bytesSource(enc))
    const forged = { ...header, chunkCount: 2, size: 2 * chunkSize }
    const headerBytes = new TextEncoder().encode(JSON.stringify(forged))
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, headerBytes.length)
    const file = concatBytes(
      new TextEncoder().encode('VDV1'),
      len,
      headerBytes,
      enc.subarray(dataOffset, dataOffset + 2 * stride),
    )
    // Chunk 1 was encrypted with last=0, so reading it as the last chunk fails.
    await expect(decryptBytes(mk, file)).rejects.toThrow(/Chunk 1 failed authentication/)
  })

  it('fails on trailing data', async () => {
    const { mk, enc } = await sample()
    await expect(decryptBytes(mk, concatBytes(enc, new Uint8Array(1)))).rejects.toThrow(
      /Unexpected data/,
    )
  })

  it('fails with the wrong master key', async () => {
    const { enc } = await sample()
    await expect(decryptBytes(await newMk(), enc)).rejects.toThrow(/another vault/)
  })

  it('fails when a file is swapped under another id', async () => {
    const { mk, enc } = await sample()
    await expect(decryptBytes(mk, enc, { expectedId: randomId() })).rejects.toThrow(IntegrityError)
  })

  it('fails on bad magic and garbage', async () => {
    const mk = await newMk()
    await expect(decryptBytes(mk, new Uint8Array(0))).rejects.toThrow(FormatError)
    await expect(decryptBytes(mk, randomBytes(100))).rejects.toThrow(/bad magic/)
  })
})
