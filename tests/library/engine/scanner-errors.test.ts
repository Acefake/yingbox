import * as fs from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ageTree, scanEnv, tempTree } from './helpers'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

afterEach(() => vi.mocked(fs.stat).mockReset())

describe('扫描文件读取异常', () => {
  it('首次扫描中读不到的新文件延后重试，不阻塞正常文件', async () => {
    const tree = tempTree()
    const actual = await vi.importActual<typeof fs>('node:fs/promises')
    const bad = tree.write('Movie/Bad.mkv', 'bad')
    tree.write('Movie/Good.mkv', 'good')
    const env = scanEnv(tree.root)
    try {
      vi.mocked(fs.stat).mockImplementation((...args) =>
        String(args[0]) === bad
          ? Promise.reject(Object.assign(new Error('EIO'), { code: 'EIO' }))
          : actual.stat(...args)
      )
      expect((await env.scan()).added).toBe(1)
      vi.mocked(fs.stat).mockImplementation(actual.stat)
      expect((await env.scan()).added).toBe(1)
      expect(env.db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n).toBe(2)
    } finally {
      env.db.close()
      tree.cleanup()
    }
  })
  it.each(['', 'Movies/'])(
    '单文件长期失败不阻塞 %s 同目录新增与改名',
    async prefix => {
      const tree = tempTree()
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      vi.mocked(fs.stat).mockImplementation(actual.stat)
      const bad = tree.write(`${prefix}Bad.mkv`, 'bad')
      const good = tree.write(`${prefix}Good.mkv`, 'good')
      const env = scanEnv(tree.root)
      try {
        await env.scan()
        const before = env.db
          .prepare('SELECT * FROM files WHERE name = ?')
          .get('Bad.mkv')
        renameSync(good, join(tree.root, prefix, 'Renamed.mkv'))
        tree.write(`${prefix}New.mkv`, 'new')
        vi.mocked(fs.stat).mockImplementation((...args) =>
          String(args[0]) === bad
            ? Promise.reject(
                Object.assign(new Error('EACCES'), { code: 'EACCES' })
              )
            : actual.stat(...args)
        )
        const result = await env.scan({ full: true })
        expect(result.added).toBe(2)
        expect(result.removed).toBe(1)
        expect(
          env.db
            .prepare('SELECT name FROM files ORDER BY name')
            .all()
            .map(row => row.name)
        ).toEqual(['Bad.mkv', 'New.mkv', 'Renamed.mkv'])
        expect(
          env.db.prepare('SELECT * FROM files WHERE name = ?').get('Bad.mkv')
        ).toEqual(before)
        expect(env.db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n).toBe(
          3
        )
        tree.write(`${prefix}Next.mkv`, 'next')
        expect((await env.scan()).added).toBe(1)
      } finally {
        env.db.close()
        tree.cleanup()
      }
    }
  )
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
    '%s 时保留失败文件快照，其余文件照常入库',
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
        expect(
          env.db.prepare("SELECT * FROM files WHERE kind = 'video'").all()
        ).toEqual(before)
        expect(failed.added).toBe(1)
        expect(env.db.prepare('SELECT * FROM media_items').all()).toEqual(items)
        vi.mocked(fs.stat).mockImplementation(actual.stat)
        const recovered = await env.scan()
        expect(recovered.added).toBe(0)
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
