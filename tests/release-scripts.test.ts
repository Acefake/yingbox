import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertVersion } from '../scripts/release/check-version.mjs'
import { checksumLines, writeChecksums } from '../scripts/release/checksums.mjs'
import { readReleaseNotes } from '../scripts/release/notes.mjs'
import { mismatches } from '../scripts/release/publish.mjs'
import { androidVersionFile } from '../scripts/release/set-android-version.mjs'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yb-release-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('发布脚本', () => {
  it('sha256sum.txt：按文件名排序、不含自身、摘要正确', async () => {
    await writeFile(join(dir, 'b.exe'), 'bbb')
    await writeFile(join(dir, 'a.apk'), 'aaa')
    const lines = await writeChecksums(dir)
    const sum = (text: string): string =>
      createHash('sha256').update(text).digest('hex')
    expect(lines).toEqual([`${sum('aaa')}  a.apk`, `${sum('bbb')}  b.exe`])
    expect(await readFile(join(dir, 'sha256sum.txt'), 'utf8')).toBe(
      `${lines.join('\n')}\n`
    )
    expect(await checksumLines(dir)).toEqual(lines)
  })

  it('目录里没有文件时不生成空的校验文件', async () => {
    await expect(writeChecksums(dir)).rejects.toThrow('没有安装包')
  })

  it('标签必须是 vX.Y.Z 且与 package.json 一致', () => {
    expect(assertVersion('v1.0.3', '1.0.3')).toBe('1.0.3')
    expect(() => assertVersion('1.0.3', '1.0.3')).toThrow('vX.Y.Z')
    expect(() => assertVersion('v1.0.3-nas.1', '1.0.3')).toThrow('vX.Y.Z')
    expect(() => assertVersion('v1.0.4', '1.0.3')).toThrow('不一致')
  })

  it('安卓版本文件只接受 x.y.z 且在版本码范围内', () => {
    expect(androidVersionFile('1.0.3')).toBe('versionName=1.0.3\n')
    expect(() => androidVersionFile('1.0')).toThrow('x.y.z')
    expect(() => androidVersionFile('1.100.0')).toThrow('范围')
    expect(() => androidVersionFile('0.0.0')).toThrow('范围')
  })

  it('发布说明只读 docs/release-notes，缺文件或空文件就报错', async () => {
    const notesDir = join(dir, 'docs/release-notes')
    await mkdir(notesDir, { recursive: true })
    await writeFile(join(notesDir, '1.0.3.md'), '新增\n- 测试说明\n')
    await expect(readReleaseNotes(dir, '1.0.3')).resolves.toBe(
      '新增\n- 测试说明\n'
    )
    await expect(readReleaseNotes(dir, '9.9.9')).rejects.toThrow('缺少发布说明')
    await writeFile(join(notesDir, 'empty.md'), '  \n')
    await expect(readReleaseNotes(dir, 'empty')).rejects.toThrow('是空的')
  })
})

describe('发布核对', () => {
  const local = [{ name: 'a.exe', size: 3, sha256: 'f'.repeat(64) }]
  const remote = (extra: Record<string, unknown> = {}): unknown[] => [
    {
      name: 'a.exe',
      state: 'uploaded',
      size: 3,
      digest: `sha256:${'f'.repeat(64)}`,
      ...extra,
    },
  ]
  it('远端资产与本地一致才算通过', () => {
    expect(mismatches(remote(), local)).toEqual([])
    expect(mismatches([], local)).toEqual(['a.exe'])
    expect(mismatches(remote({ size: 4 }), local)).toEqual(['a.exe'])
    expect(mismatches(remote({ state: 'starter' }), local)).toEqual(['a.exe'])
    expect(mismatches(remote({ digest: 'sha256:0' }), local)).toEqual(['a.exe'])
  })
})
