import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareMpvSources } from '../scripts/mpv-sources.mjs'

const roots: string[] = []
const tarPath =
  process.platform === 'win32'
    ? join(process.env.WINDIR || 'C:/Windows', 'System32/tar.exe')
    : 'tar'
const hash = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex')

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; source: Buffer; binary: Buffer } {
  const root = mkdtempSync(join(tmpdir(), 'yingbox-mpv-source-'))
  roots.push(root)
  for (const dir of [
    'src/shared',
    'docs',
    'licenses',
    'fixture/source/pkg',
    'fixture/binary',
  ])
    mkdirSync(join(root, dir), { recursive: true })
  const recipe = 'pkgname=fixture\npkgver=1\n'
  writeFileSync(join(root, 'fixture/source/pkg/PKGBUILD'), recipe)
  writeFileSync(
    join(root, 'fixture/binary/.BUILDINFO'),
    `pkgbuild_sha256sum = ${hash(recipe)}\n`
  )
  writeFileSync(join(root, 'fixture/binary/.PKGINFO'), 'pkgname = fixture\n')
  execFileSync(
    tarPath,
    [
      '-cf',
      join(root, 'source.tar'),
      '-C',
      join(root, 'fixture/source'),
      'pkg',
    ],
    { windowsHide: true }
  )
  execFileSync(
    tarPath,
    [
      '-cf',
      join(root, 'binary.tar'),
      '-C',
      join(root, 'fixture/binary'),
      '.BUILDINFO',
      '.PKGINFO',
    ],
    { windowsHide: true }
  )
  const source = readFileSync(join(root, 'source.tar'))
  const binary = readFileSync(join(root, 'binary.tar'))
  writeFileSync(join(root, 'docs/release-licenses.md'), '# Building\n')
  writeFileSync(
    join(root, 'src/shared/mpv-distribution.json'),
    JSON.stringify({
      id: 'fixture',
      binaryRepository: 'https://fixture.invalid/',
      packages: [],
      buildInputs: [
        {
          name: 'fixture',
          version: '1',
          filename: 'binary.tar',
          sha256: hash(binary),
          licenses: ['MIT'],
          homepage: 'https://fixture.invalid',
          sourceKey: 'pkg',
          pkgbuildSha256: hash(recipe),
        },
      ],
      sources: [
        {
          key: 'pkg',
          name: 'pkg',
          filename: 'source.tar',
          url: 'https://fixture.invalid/source.tar',
          sha256: hash(source),
          pkgbuildSha256: hash(recipe),
        },
      ],
    })
  )
  return { root, source, binary }
}

describe('mpv 对应源码归档', () => {
  it('空缓存自动补齐 buildInputs 的二进制包，归档后可离线复用', async () => {
    const { root, source, binary } = fixture()
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          new Uint8Array(url.endsWith('source.tar') ? source : binary)
        )
    )
    await prepareMpvSources({ root, fetcher, tarPath })
    expect(fetcher).toHaveBeenCalledWith('https://fixture.invalid/binary.tar')
    const archive = join(root, 'resources/mpv-sources/fixture-sources.tar')
    const listing = execFileSync(tarPath, ['-tf', archive], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(listing).toContain('binary-metadata/binary.tar.BUILDINFO')
    expect(listing).toContain('sources/source.tar')
    fetcher.mockImplementation(async () => {
      throw new Error('应复用已校验缓存')
    })
    await prepareMpvSources({ root, fetcher, tarPath })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('构建输入损坏时拒绝归档并清理下载临时文件', async () => {
    const { root, source } = fixture()
    const fetcher = async (url: string): Promise<Response> =>
      new Response(
        url.endsWith('source.tar') ? new Uint8Array(source) : 'corrupt'
      )
    await expect(prepareMpvSources({ root, fetcher, tarPath })).rejects.toThrow(
      '校验失败'
    )
    expect(() =>
      readFileSync(join(root, 'output/mpv-cache/packages/binary.tar.part'))
    ).toThrow()
    expect(() =>
      readFileSync(join(root, 'resources/mpv-sources/source-bundle.json'))
    ).toThrow()
  })
})
