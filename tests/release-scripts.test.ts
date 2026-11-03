import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { androidVersionFile } from '../scripts/release/set-android-version.mjs'
import { assertVersion } from '../scripts/release/check-version.mjs'
import { checksumLines, writeChecksums } from '../scripts/release/checksums.mjs'
import {
  findSources,
  sourcesTagOf,
} from '../scripts/release/publish-mpv-sources.mjs'
import { platformOf, releaseNotes } from '../scripts/release/notes.mjs'
import { mismatches } from '../scripts/release/publish.mjs'

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

  it('发布说明按文件名列出各端安装包，不认识的文件不列', () => {
    expect(platformOf('yingbox-setup-1.0.3.exe')).toBe('Windows')
    expect(platformOf('yingbox-1.0.3.dmg')).toBe('macOS')
    expect(platformOf('sha256sum.txt')).toBeNull()
    const text = releaseNotes({
      version: '1.0.3',
      sourcesTag: 'mpv-sources-x',
      files: [
        'yingbox-setup-1.0.3.exe',
        'yingbox-android-1.0.3-arm64-v8a.apk',
        'sha256sum.txt',
      ],
    })
    expect(text).toContain('yingbox-setup-1.0.3.exe')
    expect(text).toContain('arm64-v8a')
    expect(text).not.toContain('| sha256sum.txt')
    expect(text).toContain('yingbox-nas:1.0.3-nas.1')
    expect(text).toContain('releases/tag/mpv-sources-x')
  })

  it('mpv 源码包：标签由文件名得出，并带上校验与说明文件', async () => {
    expect(
      sourcesTagOf('msys2-ucrt64-mpv-0.41.0-10-20261028-sources.tar')
    ).toBe('mpv-sources-msys2-ucrt64-mpv-0.41.0-10-20261028')
    expect(() => sourcesTagOf('x.zip')).toThrow('不是 mpv 源码包')
    for (const name of [
      'a-sources.tar',
      'a-sources.tar.sha256',
      'MPV-SOURCE-DOWNLOAD.md',
      'yingbox-setup-1.0.3.exe',
    ])
      await writeFile(join(dir, name), 'x')
    const { tag, files } = await findSources(dir)
    expect(tag).toBe('mpv-sources-a')
    expect(files.map(f => basename(f)).sort()).toEqual([
      'MPV-SOURCE-DOWNLOAD.md',
      'a-sources.tar',
      'a-sources.tar.sha256',
    ])
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
