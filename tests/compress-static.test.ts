/**
 * 构建后写出 .br / .gz：只压可压缩文本，且只在更小的时候落盘。
 */
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compressStaticDir } from '../scripts/compress-static'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('compressStaticDir', () => {
  it('为 js / html 写出可解压的 .br 与 .gz，跳过图片和压不小的文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yingbox-compress-'))
    dirs.push(dir)
    const source = 'const x = "player";\n'.repeat(80)
    writeFileSync(join(dir, 'app.js'), source)
    writeFileSync(join(dir, 'index.html'), `<html>${'影盒'.repeat(40)}</html>`)
    writeFileSync(
      join(dir, 'icon.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    )
    writeFileSync(join(dir, 'tiny.js'), 'x')

    const written = await compressStaticDir(dir)
    expect(written.br).toBeGreaterThan(0)
    expect(written.gz).toBeGreaterThan(0)
    expect(
      brotliDecompressSync(readFileSync(join(dir, 'app.js.br'))).toString()
    ).toBe(source)
    expect(gunzipSync(readFileSync(join(dir, 'app.js.gz'))).toString()).toBe(
      source
    )
    expect(readdirSync(dir).filter(name => name.includes('icon.png.'))).toEqual(
      []
    )
    expect(
      readdirSync(dir).filter(name => name.startsWith('tiny.js.'))
    ).toEqual([])
  })
})
