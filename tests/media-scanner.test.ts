import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type MediaIndexEntry, scanMediaDirectory } from '../src/main/media-scanner'

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
})
