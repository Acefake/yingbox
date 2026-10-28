import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { validateMpvLocalFile } from '../src/main/mpv-local-file'

it('本地路径必须指向存在的文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yingbox-mpv-file-'))
  try {
    const movie = join(dir, 'movie.mkv')
    await mkdir(movie)
    await expect(validateMpvLocalFile(movie)).rejects.toThrow('不是视频文件')
    await expect(
      validateMpvLocalFile(join(dir, 'missing.mkv'))
    ).rejects.toThrow('视频文件不存在')
    const valid = join(dir, 'valid.mkv')
    await writeFile(valid, '')
    await expect(validateMpvLocalFile(valid)).resolves.toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
