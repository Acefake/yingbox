import * as fs from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ageTree, scanEnv, tempTree } from './helpers'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

afterEach(() => vi.mocked(fs.stat).mockReset())

describe('扫描文件读取异常', () => {
  it('目录 mtime 未变的全量扫描失败后，普通扫描仍会重读', async () => {
    const tree = tempTree()
    const actual = await vi.importActual<typeof fs>('node:fs/promises')
    vi.mocked(fs.stat).mockImplementation(actual.stat)
    const file = tree.write('Movie (2000)/Movie.mkv', 'video')
    ageTree(tree.root)
    const env = scanEnv(tree.root)
    try {
      await env.scan()
      writeFileSync(file, 'longer video content')
      vi.mocked(fs.stat).mockImplementation((...args) => {
        if (String(args[0]) === file)
          return Promise.reject(
            Object.assign(new Error('EIO'), { code: 'EIO' })
          )
        return actual.stat(...args)
      })
      await env.scan({ full: true })
      vi.mocked(fs.stat).mockImplementation(actual.stat)
      expect((await env.scan()).changed).toBe(1)
    } finally {
      env.db.close()
      tree.cleanup()
    }
  })
  it.each(['EACCES', 'EIO'])(
    '%s 时保留目录快照，恢复后能继续扫描',
    async code => {
      const tree = tempTree()
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      vi.mocked(fs.stat).mockImplementation(actual.stat)
      const file = tree.write('Movie (2000)/Movie.mkv', 'video')
      const env = scanEnv(tree.root)
      try {
        ageTree(tree.root)
        await env.scan()
        const before = env.db.prepare('SELECT * FROM files').all()
        const items = env.db.prepare('SELECT * FROM media_items').all()
        tree.write('Movie (2000)/movie.nfo', '<movie/>')
        vi.mocked(fs.stat).mockImplementation((...args) => {
          if (String(args[0]) === file)
            return Promise.reject(Object.assign(new Error(code), { code }))
          return actual.stat(...args)
        })
        const failed = await env.scan({ full: true })
        expect(failed.warnings.join(' ')).toContain(code)
        expect(failed.removed).toBe(0)
        expect(env.db.prepare('SELECT * FROM files').all()).toEqual(before)
        expect(env.db.prepare('SELECT * FROM media_items').all()).toEqual(items)
        vi.mocked(fs.stat).mockImplementation(actual.stat)
        const recovered = await env.scan()
        expect(recovered.added).toBe(1)
        expect(
          env.db.prepare('SELECT id FROM files WHERE kind = ?').get('video')?.id
        ).toBe(before[0].id)
      } finally {
        env.db.close()
        tree.cleanup()
      }
    }
  )
})
