// Minimal ZIP support (no compression library needed):
//  - ZipWriter: "store" method only (our files are ciphertext and don't compress), no ZIP64.
//  - readZip: stored and deflated entries (Drive's "Download folder" zips use deflate), ZIP64 aware.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}

async function crc32Blob(blob: Blob): Promise<number> {
  let crc = 0
  const step = 4 * 1024 * 1024
  for (let offset = 0; offset < blob.size; offset += step) {
    crc = crc32(new Uint8Array(await blob.slice(offset, offset + step).arrayBuffer()), crc)
  }
  return crc
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

const LIMIT = 0xffffffff

export class ZipLimitError extends Error {
  constructor() {
    super(
      'The backup is larger than 4 GiB or has more than 65 535 files, which this zip writer does not support.',
    )
    this.name = 'ZipLimitError'
  }
}

export class ZipWriter {
  private parts: BlobPart[] = []
  private central: Uint8Array<ArrayBuffer>[] = []
  private offset = 0
  private count = 0
  private encoder = new TextEncoder()

  async add(path: string, data: Blob, modified: Date = new Date()): Promise<void> {
    const name = this.encoder.encode(path)
    const crc = await crc32Blob(data)
    const size = data.size
    if (size >= LIMIT || this.offset + size + 30 + name.length >= LIMIT || this.count >= 0xffff) {
      throw new ZipLimitError()
    }
    const { time, date } = dosDateTime(modified)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, this.offset, true)
    cd.set(name, 46)

    this.parts.push(local, data)
    this.central.push(cd)
    this.offset += local.length + size
    this.count++
  }

  finish(): Blob {
    const cdSize = this.central.reduce((n, c) => n + c.length, 0)
    if (this.offset + cdSize + 22 >= LIMIT) throw new ZipLimitError()
    const end = new Uint8Array(22)
    const ev = new DataView(end.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, this.count, true)
    ev.setUint16(10, this.count, true)
    ev.setUint32(12, cdSize, true)
    ev.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...this.central, end], { type: 'application/zip' })
  }
}

export interface ZipEntryInfo {
  path: string
  method: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

async function read(blob: Blob, offset: number, length: number): Promise<DataView> {
  const buf = await blob.slice(offset, offset + length).arrayBuffer()
  if (buf.byteLength !== length) throw new Error('Zip file is truncated.')
  return new DataView(buf)
}

function u64(v: DataView, at: number): number {
  const n = v.getBigUint64(at, true)
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Zip value too large.')
  return Number(n)
}

export async function readZip(blob: Blob): Promise<ZipEntryInfo[]> {
  const tailLength = Math.min(blob.size, 22 + 65535)
  const tail = await read(blob, blob.size - tailLength, tailLength)
  let eocd = -1
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file.')
  let count = tail.getUint16(eocd + 10, true)
  let cdSize = tail.getUint32(eocd + 12, true)
  let cdOffset = tail.getUint32(eocd + 16, true)
  const eocdAbs = blob.size - tailLength + eocd
  if (count === 0xffff || cdSize === LIMIT || cdOffset === LIMIT) {
    const locator = await read(blob, eocdAbs - 20, 20)
    if (locator.getUint32(0, true) !== 0x07064b50) throw new Error('Bad ZIP64 locator.')
    const z = await read(blob, u64(locator, 8), 56)
    if (z.getUint32(0, true) !== 0x06064b50) throw new Error('Bad ZIP64 end record.')
    count = u64(z, 32)
    cdSize = u64(z, 40)
    cdOffset = u64(z, 48)
  }
  const cd = await read(blob, cdOffset, cdSize)
  const decoder = new TextDecoder()
  const entries: ZipEntryInfo[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip central directory.')
    const flags = cd.getUint16(p + 8, true)
    const method = cd.getUint16(p + 10, true)
    let compressedSize = cd.getUint32(p + 20, true)
    let size = cd.getUint32(p + 24, true)
    const nameLength = cd.getUint16(p + 28, true)
    const extraLength = cd.getUint16(p + 30, true)
    const commentLength = cd.getUint16(p + 32, true)
    let localHeaderOffset = cd.getUint32(p + 42, true)
    const path = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength))
    let e = p + 46 + nameLength
    const extraEnd = e + extraLength
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true)
      const len = cd.getUint16(e + 2, true)
      if (id === 0x0001) {
        let q = e + 4
        if (size === LIMIT) {
          size = u64(cd, q)
          q += 8
        }
        if (compressedSize === LIMIT) {
          compressedSize = u64(cd, q)
          q += 8
        }
        if (localHeaderOffset === LIMIT) localHeaderOffset = u64(cd, q)
      }
      e += 4 + len
    }
    p = extraEnd + commentLength
    if (path.endsWith('/')) continue
    if (flags & 1) throw new Error(`Zip entry ${path} is password-protected.`)
    entries.push({ path, method, compressedSize, size, localHeaderOffset })
  }
  return entries
}

export async function zipEntryBlob(zip: Blob, entry: ZipEntryInfo): Promise<Blob> {
  const local = await read(zip, entry.localHeaderOffset, 30)
  if (local.getUint32(0, true) !== 0x04034b50) throw new Error('Bad zip local header.')
  const start = entry.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
  const raw = zip.slice(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) {
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Response(stream).blob()
  }
  throw new Error(`Zip entry ${entry.path} uses unsupported compression method ${entry.method}.`)
}
