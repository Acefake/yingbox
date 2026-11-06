/**
 * 读 ELF 动态段里的 SONAME 与 DT_NEEDED（只读，不改文件）。
 * 安卓开发构建用它从 Termux 的 Node 出发找齐要打包的动态库（ADR-0034）。
 */

const DT_NULL = 0
const DT_NEEDED = 1
const DT_STRTAB = 5
const DT_SONAME = 14
const PT_LOAD = 1
const PT_DYNAMIC = 2

/**
 * 解析 ELF 的动态依赖。
 * @param {Buffer} buf 整个文件内容
 * @returns {{ soname: string | null, needed: string[] } | null} 不是 ELF 或没有动态段时返回 null
 */
export function readDynamic(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null
  const is64 = buf[4] === 2
  if (buf[5] !== 1) throw new Error('只支持小端 ELF')
  const word = off =>
    is64 ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off)
  const phoff = word(is64 ? 0x20 : 0x1c)
  const phentsize = buf.readUInt16LE(is64 ? 0x36 : 0x2a)
  const phnum = buf.readUInt16LE(is64 ? 0x38 : 0x2c)
  const loads = []
  let dynamic = null

  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize
    const type = buf.readUInt32LE(at)
    const offset = is64 ? word(at + 8) : word(at + 4)
    const vaddr = is64 ? word(at + 16) : word(at + 8)
    const filesz = is64 ? word(at + 32) : word(at + 16)

    if (type === PT_LOAD) loads.push({ offset, vaddr, filesz })
    if (type === PT_DYNAMIC) dynamic = { offset, filesz }
  }
  if (!dynamic) return null

  const toOffset = addr => {
    const seg = loads.find(s => addr >= s.vaddr && addr < s.vaddr + s.filesz)
    if (!seg)
      throw new Error(`地址 0x${addr.toString(16)} 不在任何 PT_LOAD 段内`)
    return addr - seg.vaddr + seg.offset
  }
  const entrySize = is64 ? 16 : 8
  const entries = []
  let strtab = 0

  for (
    let at = dynamic.offset;
    at < dynamic.offset + dynamic.filesz;
    at += entrySize
  ) {
    const tag = word(at)
    const value = word(at + entrySize / 2)

    if (tag === DT_NULL) break
    if (tag === DT_STRTAB) strtab = toOffset(value)
    entries.push({ tag, value })
  }

  const str = off => {
    const start = strtab + off
    return buf.toString('utf8', start, buf.indexOf(0, start))
  }

  return {
    soname:
      entries.filter(e => e.tag === DT_SONAME).map(e => str(e.value))[0] ??
      null,
    needed: entries.filter(e => e.tag === DT_NEEDED).map(e => str(e.value)),
  }
}
