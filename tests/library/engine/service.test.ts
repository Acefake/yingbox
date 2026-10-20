import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import { PARSER_VERSION } from '../../../src/main/library/scanner/parse'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { count, tempTree } from './helpers'

let tree: ReturnType<typeof tempTree>
let dbDir: string
beforeEach(() => {
  tree = tempTree()
  dbDir = mkdtempSync(join(tmpdir(), 'yingbox-svc-'))
})
afterEach(() => {
  tree.cleanup()
  rmSync(dbDir, { recursive: true, force: true })
})

describe('LibraryService 后台任务', () => {
  it('扫描后排指纹任务，为新视频算出 OpenSubtitles hash', async () => {
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(150_003, 1))
    tree.write('A (2001)/poster.jpg', 'img')
    const service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie' })
    await service.queue.idle()
    await service.queue.idle()

    const rows = service.db
      .prepare('SELECT kind, fingerprint FROM files ORDER BY kind')
      .all()
      .map(r => [r.kind, r.fingerprint])
    expect(rows).toEqual([
      ['image', null],
      ['video', expect.stringMatching(/^[0-9a-f]{16}$/)],
    ])
    await service.close()
  })

  it('解析版本落后时启动即重解析并重新分组，重启后数据还在', async () => {
    tree.write('Dune (2021)/Dune (2021).mkv')
    const dbPath = join(dbDir, 'library.db')
    const first = new LibraryService({ dbPath, watch: false })
    await first.start()
    await first.addLibrary({ root: tree.root, kind: 'movie' })
    await first.queue.idle()
    // 模拟旧版本解析器写入的错误分组
    first.db.exec(`UPDATE files SET parser_version = 0;
      UPDATE media_items SET title = '旧标题', local_key = 'movie:1:old:'`)
    await first.close()

    const second = new LibraryService({ dbPath, watch: false })
    await second.start()
    await second.queue.idle()

    expect(count(second.db, 'SELECT MIN(parser_version) FROM files')).toBe(
      PARSER_VERSION
    )
    const titles = second
      .query(normalizeLibraryQuery({}))
      .items.map(i => i.title)
    expect(titles).toEqual(['Dune']) // 旧条目失去文件被回收，新条目按新解析建立
    expect(second.listLibraries()).toHaveLength(1)
    await second.close()
  })
})
