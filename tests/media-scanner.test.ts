import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type MediaIndexEntry,
  scanMediaDirectory,
} from '../src/main/media-scanner'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yingbox-scan-'))
  await writeFile(join(root, 'Movie.mkv'), 'x')
  await writeFile(join(root, 'Movie.nfo'), '<movie/>')
  await writeFile(join(root, 'notes.txt'), 'nope')
  await writeFile(join(root, '.hidden.mp4'), 'x')
  await mkdir(join(root, 'Season 1'))
  await writeFile(join(root, 'Season 1', 'Ep1.mp4'), 'x')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanMediaDirectory', () => {
  it('keeps media and sidecar files, drops dotfiles and other files', async () => {
    const { data, warnings } = await scanMediaDirectory(root)
    expect(data.map(item => item.name).sort()).toEqual([
      'Ep1.mp4',
      'Movie.mkv',
      'Movie.nfo',
      'Season 1',
    ])
    expect(warnings).toEqual([])
  })

  it('reuses cached descendants when a directory is unchanged', async () => {
    const first = await scanMediaDirectory(root)
    const index: MediaIndexEntry[] = first.data.map(item => ({ ...item }))
    const second = await scanMediaDirectory(root, index)

    expect(second.reused).toBeGreaterThan(0)
    expect(second.data.map(item => item.name)).toContain('Ep1.mp4')
    expect(second.data).toHaveLength(first.data.length)
  })

  it('detects added and removed files two levels below an unchanged directory', async () => {
    const season = join(root, 'Show', 'Season 1')
    await mkdir(season, { recursive: true })
    await writeFile(join(season, 'S01E01.mkv'), 'x')
    const first = await scanMediaDirectory(root)

    // 只动孙子层：Show 自身的 mtime 不变，Season 1 的 mtime 变化。
    await writeFile(join(season, 'S01E02.mkv'), 'x')
    await unlink(join(season, 'S01E01.mkv'))
    await bumpMtime(season)
    const second = await scanMediaDirectory(root, first.data)
    const names = second.data.map(item => item.name)

    expect(names).toContain('S01E02.mkv')
    expect(names).not.toContain('S01E01.mkv')
  })

  it('reuses direct files of an unchanged directory but still descends into its subdirectories', async () => {
    const show = join(root, 'Show')
    await mkdir(join(show, 'Season 2'), { recursive: true })
    await writeFile(join(show, 'tvshow.nfo'), '<tvshow/>')
    await writeFile(join(show, 'Season 2', 'S02E01.mkv'), 'x')
    const first = await scanMediaDirectory(root)

    await writeFile(join(show, 'Season 2', 'S02E02.mkv'), 'x')
    await bumpMtime(join(show, 'Season 2'))
    const second = await scanMediaDirectory(root, first.data)
    const names = second.data.map(item => item.name)

    expect(names).toEqual(
      expect.arrayContaining(['tvshow.nfo', 'S02E01.mkv', 'S02E02.mkv'])
    )
    expect(second.data).toHaveLength(first.data.length + 1)
    expect(second.reused).toBeGreaterThan(0)
  })
})

/** 把目录 mtime 推后 10 秒，避免文件系统 mtime 粒度（数毫秒）让两次写入看起来没变。 */
async function bumpMtime(dir: string): Promise<void> {
  const { mtime } = await stat(dir)
  const next = new Date(mtime.getTime() + 10_000)
  await utimes(dir, next, next)
}
