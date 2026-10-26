/**
 * 极简 OLE2 / CDF（Compound Document File）读取器。
 *
 * 用途：Word 97-2003 的 .doc 是复合文档，正文在 `WordDocument` 流，
 * 图片等二进制资源在 `Data` 流。这里只实现读流所需的最小集合：
 *   header → DIFAT → FAT → 目录项 → 普通流 / 迷你流
 *
 * 参考 [MS-CFB]。不依赖任何第三方库。
 */

const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export function isCdf(buf) {
  return buf.length >= 512 && buf.subarray(0, 8).equals(SIGNATURE)
}

/**
 * @param {Buffer} buf 整个 .doc 文件
 * @returns {{ list: () => Array<{name: string, type: number, size: number}>, stream: (name: string) => Buffer | null }}
 */
export function openCdf(buf) {
  if (!isCdf(buf)) throw new Error('不是 OLE2 复合文档（可能不是 .doc）')

  const sectorSize = 1 << buf.readUInt16LE(30)
  const miniSectorSize = 1 << buf.readUInt16LE(32)
  const numFatSectors = buf.readUInt32LE(44)
  const firstDirSector = buf.readUInt32LE(48)
  const miniCutoff = buf.readUInt32LE(56)
  const firstMiniFatSector = buf.readUInt32LE(60)
  const numMiniFatSectors = buf.readUInt32LE(64)
  const firstDifatSector = buf.readUInt32LE(68)

  const sectorOffset = (s) => 512 + s * sectorSize
  const sectorCount = Math.max(0, Math.floor((buf.length - 512) / sectorSize))

  /* —— DIFAT：FAT 扇区的位置表 —— */
  const fatSectorIds = []
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(76 + i * 4)
    if (v !== FREESECT && v !== ENDOFCHAIN) fatSectorIds.push(v)
  }
  let difat = firstDifatSector
  for (let guard = 0; difat !== ENDOFCHAIN && difat !== FREESECT && guard < 4096; guard++) {
    if (difat >= sectorCount) break
    const off = sectorOffset(difat)
    const per = sectorSize / 4 - 1
    for (let i = 0; i < per; i++) {
      const v = buf.readUInt32LE(off + i * 4)
      if (v !== FREESECT && v !== ENDOFCHAIN) fatSectorIds.push(v)
    }
    difat = buf.readUInt32LE(off + sectorSize - 4)
  }

  /* —— FAT 表 —— */
  const fat = new Uint32Array(Math.max(numFatSectors, fatSectorIds.length) * (sectorSize / 4))
  let write = 0
  for (const sid of fatSectorIds) {
    if (sid >= sectorCount) continue
    const off = sectorOffset(sid)
    for (let i = 0; i < sectorSize / 4 && write < fat.length; i++) {
      fat[write++] = buf.readUInt32LE(off + i * 4)
    }
  }

  const chainOf = (start, table) => {
    const out = []
    let s = start
    for (let guard = 0; s !== ENDOFCHAIN && s !== FREESECT && guard < 1_000_000; guard++) {
      if (s >= sectorCount && table === fat) break
      out.push(s)
      const next = table[s]
      if (next === undefined) break
      s = next
    }
    return out
  }

  const readSectors = (start) => {
    const parts = []
    for (const s of chainOf(start, fat)) {
      if (s >= sectorCount) break
      parts.push(buf.subarray(sectorOffset(s), sectorOffset(s) + sectorSize))
    }
    return Buffer.concat(parts)
  }

  /* —— 目录项 —— */
  const dirBuf = readSectors(firstDirSector)
  const entries = []
  for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
    const nameLen = dirBuf.readUInt16LE(off + 64)
    const type = dirBuf[off + 66]
    if (type === 0 || nameLen === 0 || nameLen > 64) continue
    entries.push({
      name: dirBuf.subarray(off, off + nameLen - 2).toString('utf16le'),
      type,
      start: dirBuf.readUInt32LE(off + 116),
      size: Number(dirBuf.readBigUInt64LE(off + 120)),
    })
  }

  /* —— 迷你流（小于 4096 字节的流存在这里）—— */
  const root = entries.find((e) => e.type === 5)
  let miniStream = Buffer.alloc(0)
  let miniFat = new Uint32Array(0)
  if (root) {
    miniStream = readSectors(root.start).subarray(0, root.size)
    if (numMiniFatSectors > 0) {
      const raw = readSectors(firstMiniFatSector).subarray(0, numMiniFatSectors * sectorSize)
      miniFat = new Uint32Array(raw.length / 4)
      for (let i = 0; i < miniFat.length; i++) miniFat[i] = raw.readUInt32LE(i * 4)
    }
  }

  const stream = (name) => {
    const entry = entries.find((e) => e.type === 2 && e.name === name)
    if (!entry) return null
    if (entry.size < miniCutoff) {
      const parts = []
      let s = entry.start
      for (let guard = 0; s !== ENDOFCHAIN && s !== FREESECT && guard < 1_000_000; guard++) {
        const off = s * miniSectorSize
        if (off >= miniStream.length) break
        parts.push(miniStream.subarray(off, off + miniSectorSize))
        const next = miniFat[s]
        if (next === undefined) break
        s = next
      }
      return Buffer.concat(parts).subarray(0, entry.size)
    }
    return readSectors(entry.start).subarray(0, entry.size)
  }

  return {
    list: () => entries.filter((e) => e.type === 2).map(({ name, type, size }) => ({ name, type, size })),
    stream,
  }
}
