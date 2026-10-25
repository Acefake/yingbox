/**
 * 视频关键帧（真实服务 + 假推理后端 + 假取帧）：打开后抽帧入库、去掉相近帧、搜索带时间点、
 * 图片重建不动帧、暂停后断点续跑、有别的任务时让出、网盘默认跳过、文件变了整份重抽、V9 迁移保留旧向量。
 *
 * 假取帧：帧的「内容」k 写在像素第 0 字节，按时间每 60 秒换一个画面（30 秒一帧，相邻两帧相同会被去重）；
 * SSIS-2 的画面编号整体加 20。假后端把 k 编成第 k 维的单位向量，文字 "k=12" 编成第 12 维。
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate } from '../../../src/main/library/db/migrations'
import { LibraryService } from '../../../src/main/library/engine/service'
import type { VisualBackend } from '../../../src/main/library/visual/clip-backend'
import { CLIP_DIM } from '../../../src/main/library/visual/clip-encoder'
import type { ExtractFrame } from '../../../src/main/library/visual/frames/frame-indexer'
import { tempTree } from '../engine/helpers'

const unit = (k: number): Float32Array => {
  const v = new Float32Array(CLIP_DIM)
  v[k] = 1
  return v
}

function fakeBackend(): VisualBackend {
  return {
    model: 'fake',
    available: async () => true,
    modelReady: async () => true,
    download: async () => {},
    embedImages: async images => images.map(px => unit(px[0]!)),
    embedText: async text => unit(Number(text.split('=')[1])),
  }
}

/** 时间点 → 画面编号（SSIS-2 加 20）。 */
const sceneOf = (path: string, atSec: number): number =>
  10 + Math.floor(atSec / 60) + (path.includes('SSIS-2') ? 20 : 0)

describe('视频关键帧', () => {
  let tree: ReturnType<typeof tempTree>
  let dataDir: string
  let service: LibraryService
  let calls: Array<{ path: string; at: number }>
  /** 第几次取帧时触发（测试暂停用）。 */
  let onCall: (n: number) => void

  const extract: ExtractFrame = async (_bin, input, atSec, thumb, signal) => {
    calls.push({ path: input, at: atSec })
    onCall(calls.length)
    signal.throwIfAborted()
    writeFileSync(thumb, 'jpg')
    return new Uint8Array([sceneOf(input, atSec)])
  }

  async function setup(storage: 'auto' | 'cloud' = 'auto'): Promise<void> {
    service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: {
        mediaDir: join(dataDir, 'media'),
        // 原图：JPEG 头 + 内容字节（封面测试用）
        fetch: (async (url: string) => ({
          status: 200,
          url,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 3]).buffer,
          text: async () => '',
        })) as never,
      },
      visual: {
        backend: fakeBackend(),
        pixels: async bytes => new Uint8Array([bytes[2]!]),
        frames: {
          ffmpegPath: async () => 'ffmpeg',
          extract,
          // 5 分钟：10 帧，去重后 5 帧
          duration: async () => 300,
          idleRetryMs: 10,
        },
      },
    })
    await service.start()
    for (const code of ['SSIS-1', 'SSIS-2']) tree.write(`${code}.mp4`)
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      source: 'jav',
      automation: { identify: false, watch: false, storage },
    })
    await service.queue.idle()
    for (const code of ['SSIS-1', 'SSIS-2']) {
      service.db
        .prepare(
          "UPDATE media_items SET metadata = ? WHERE upper(title) = ? AND type = 'movie'"
        )
        .run(JSON.stringify({ level: 'title', images: [] }), code)
    }
  }

  const itemOf = (code: string): number =>
    Number(
      (
        service.db
          .prepare('SELECT id FROM media_items WHERE upper(title) = ?')
          .get(code) as { id: number }
      ).id
    )
  const frameRows = (): Array<{ item_id: number; at_ms: number }> =>
    service.db
      .prepare(
        "SELECT item_id, at_ms FROM visual_vectors WHERE source = 'frame' ORDER BY item_id, at_ms"
      )
      .all() as Array<{ item_id: number; at_ms: number }>
  const thumbs = (): string[] => {
    const root = join(dataDir, 'media', 'orig')
    if (!existsSync(root)) return []
    return readdirSync(root).flatMap(d => readdirSync(join(root, d)))
  }

  async function enable(
    patch: Parameters<LibraryService['visual']['setFrames']>[0] = {}
  ): Promise<void> {
    await service.visual.setFrames({ enabled: true, ...patch })
    await service.queue.idle()
  }

  beforeEach(() => {
    tree = tempTree()
    dataDir = mkdtempSync(join(tmpdir(), 'yb-frames-'))
    calls = []
    onCall = () => {}
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('默认不抽；打开后抽帧、去掉相近帧，缩略图只留保留的帧', async () => {
    await setup()
    expect((await service.visual.status()).frames).toMatchObject({
      enabled: false,
      indexed: 0,
      total: 2,
      frames: 0,
    })
    await service.queue.idle()
    expect(calls).toHaveLength(0)

    await enable()
    expect(calls).toHaveLength(20)
    const rows = frameRows()
    expect(rows).toHaveLength(10)
    expect(
      rows.filter(r => r.item_id === itemOf('SSIS-1')).map(r => r.at_ms)
    ).toEqual([15_000, 75_000, 135_000, 195_000, 255_000])
    expect(thumbs().filter(f => !f.includes('.partial'))).toHaveLength(10)
    expect(thumbs().some(f => f.includes('.partial'))).toBe(false)
    expect((await service.visual.status()).frames).toMatchObject({
      enabled: true,
      running: false,
      indexed: 2,
      total: 2,
      frames: 10,
      error: null,
    })

    // 再排一次：都抽过了，不再取帧
    await service.visual.setFrames({ enabled: true })
    await service.queue.idle()
    expect(calls).toHaveLength(20)
  })

  it('搜索：最像的是视频帧时带文件与时间点，另带几个时间点', async () => {
    await setup()
    await enable()
    const [top] = await service.visual.search({ text: 'k=12' })
    expect(top).toMatchObject({
      itemId: itemOf('SSIS-1'),
      score: 1,
      frame: { at: 135 },
    })
    expect(top!.image).toMatch(/^yingbox-media:\/\/image\/[0-9a-f]{32}$/)
    expect(top!.moments).toHaveLength(3)
    expect(top!.moments![0]).toMatchObject({ at: 135, image: top!.image })
    const [other] = await service.visual.search({ text: 'k=33' })
    expect(other).toMatchObject({
      itemId: itemOf('SSIS-2'),
      frame: { at: 195 },
    })
  })

  it('图片索引重建只替换封面 / 剧照，帧还在', async () => {
    await setup()
    await enable()
    const item = itemOf('SSIS-1')
    service.db.prepare('UPDATE media_items SET metadata = ? WHERE id = ?').run(
      JSON.stringify({
        level: 'title',
        images: [{ role: 'backdrop', path: 'https://img/3.jpg' }],
      }),
      item
    )
    service.visual.index()
    await service.queue.idle()
    expect(frameRows()).toHaveLength(10)
    expect(
      service.db
        .prepare(
          "SELECT COUNT(*) AS n FROM visual_vectors WHERE source = 'image'"
        )
        .get()
    ).toEqual({ n: 1 })
    // 封面（画面 3）和帧一起参与搜索
    const [cover] = await service.visual.search({ text: 'k=3' })
    expect(cover).toMatchObject({ itemId: item, image: 'https://img/3.jpg' })
    expect(cover!.frame).toBeUndefined()
    expect(cover!.moments).toHaveLength(3)
  })

  it('暂停后断点续跑：从停下的那批接着抽，不重抽已入库的帧', async () => {
    await setup()
    // 第 9 次取帧（第一个文件第二批的第一帧）时暂停
    onCall = n => {
      if (n === 9) void service.visual.setFrames({ paused: true })
    }
    await enable()
    expect(calls).toHaveLength(9)
    expect(frameRows()).toHaveLength(4)
    const paused = (await service.visual.status()).frames
    expect(paused).toMatchObject({ paused: true, running: false, indexed: 0 })

    onCall = () => {}
    await service.visual.setFrames({ paused: false })
    await service.queue.idle()
    // 第一个文件只补后 2 帧，第二个文件 10 帧
    expect(calls.slice(9).map(c => c.at)).toEqual([
      255, 285, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285,
    ])
    // 续跑的第一帧和上一批最后保留的那帧（195 秒，画面 13）不同，照常保留；去重结果与一次跑完相同
    expect(
      frameRows()
        .filter(r => r.item_id === itemOf('SSIS-1'))
        .map(r => r.at_ms)
    ).toEqual([15_000, 75_000, 135_000, 195_000, 255_000])
    expect((await service.visual.status()).frames.indexed).toBe(2)
  })

  it('有别的任务在跑时让出，空下来再接着抽', async () => {
    await setup()
    const now = Date.now()
    const other = service.db
      .prepare(
        `INSERT INTO jobs (type, payload, state, created_at, updated_at)
         VALUES ('other', '{}', 'running', ?, ?) RETURNING id`
      )
      .get(now, now) as { id: number }
    await enable()
    expect(calls).toHaveLength(0)

    service.db
      .prepare("UPDATE jobs SET state = 'done' WHERE id = ?")
      .run(other.id)
    await new Promise(resolve => setTimeout(resolve, 50))
    await service.queue.idle()
    expect(calls).toHaveLength(20)
  })

  it('网盘上的库默认跳过，设置打开后才抽', async () => {
    await setup('cloud')
    await enable()
    expect(calls).toHaveLength(0)
    expect((await service.visual.status()).frames.total).toBe(0)

    await service.visual.setFrames({ includeCloud: true })
    await service.queue.idle()
    expect(calls).toHaveLength(20)
    expect((await service.visual.status()).frames).toMatchObject({
      indexed: 2,
      total: 2,
    })
  })

  it('文件变了整份重抽，旧帧的缩略图删掉', async () => {
    await setup()
    await enable()
    const before = new Set(thumbs())
    service.db
      .prepare(
        "UPDATE files SET size = size + 1 WHERE kind = 'video' AND name LIKE 'SSIS-1%'"
      )
      .run()
    await service.visual.setFrames({ enabled: true })
    await service.queue.idle()
    expect(calls).toHaveLength(30)
    expect(frameRows()).toHaveLength(10)
    const after = new Set(thumbs())
    expect(after.size).toBe(10)
    expect([...after].filter(f => before.has(f))).toHaveLength(5)
  })
})

describe('V9 迁移', () => {
  it('旧库的图片向量记为 image 来源，帧列为空', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, MIGRATIONS.slice(0, 8))
    const now = Date.now()
    db.exec(
      `INSERT INTO libraries (id, root, root_display, kind, name, created_at)
       VALUES (1, '/a', '/a', 'movie', 'a', ${now})`
    )
    db.exec(
      `INSERT INTO media_items (id, library_id, type, local_key, added_at, updated_at)
       VALUES (1, 1, 'movie', 'k', ${now}, ${now})`
    )
    db.prepare(
      'INSERT INTO visual_vectors (item_id, image, vec) VALUES (1, ?, ?)'
    ).run('https://img/1.jpg', new Uint8Array(516))
    expect(migrate(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(
      db
        .prepare('SELECT image, source, file_id, at_ms FROM visual_vectors')
        .all()
    ).toEqual([
      {
        image: 'https://img/1.jpg',
        source: 'image',
        file_id: null,
        at_ms: null,
      },
    ])
    expect(() =>
      db
        .prepare(
          "INSERT INTO visual_vectors (item_id, image, vec, source) VALUES (1, 'x', x'00', 'other')"
        )
        .run()
    ).toThrow()
    // 条目删除时帧进度级联清掉
    db.exec(
      `INSERT INTO files (id, library_id, path, display_path, dir, name, kind, size, mtime, added_at, updated_at)
       VALUES (1, 1, '/a/x.mp4', '/a/x.mp4', '/a', 'x.mp4', 'video', 1, 1, ${now}, ${now})`
    )
    db.exec(
      `INSERT INTO visual_frames (file_id, item_id, model, signature, planned, state, updated_at)
       VALUES (1, 1, 'm', 's', 10, 'running', ${now})`
    )
    db.exec('DELETE FROM files WHERE id = 1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM visual_frames').get()).toEqual(
      {
        n: 0,
      }
    )
    db.close()
  })
})
