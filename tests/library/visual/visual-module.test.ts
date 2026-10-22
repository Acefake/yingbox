/**
 * 按画面搜（真实服务 + 假推理后端）：建索引、按图片列表签名增量、搜索每部取最像的图、
 * 运行时不可用时任务失败并记下原因、启用后识别才派补索引任务。
 *
 * 假后端：图片的「内容」是原图字节第 3 个字节 k，向量是第 k 维的单位向量；文字 "k=5" 编成第 5 维。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import type { VisualBackend } from '../../../src/main/library/visual/clip-backend'
import { CLIP_DIM } from '../../../src/main/library/visual/clip-encoder'
import { tempTree } from '../engine/helpers'

const unit = (k: number): Float32Array => {
  const v = new Float32Array(CLIP_DIM)
  v[k] = 1
  return v
}

/** 地址里的数字就是图片内容 k：https://img/7.jpg → 7。 */
const kOf = (url: string): number => Number(/(\d+)\.jpg/.exec(url)![1])

function fakeBackend(available = true): VisualBackend & { downloads: number } {
  let ready = false
  const backend = {
    model: 'fake',
    downloads: 0,
    available: async () => available,
    modelReady: async () => ready,
    download: async (onProgress: (f: number) => void) => {
      backend.downloads++
      onProgress(1)
      ready = true
    },
    embedImages: async (images: Uint8Array[]) => images.map(px => unit(px[0]!)),
    embedText: async (text: string) => unit(Number(text.split('=')[1])),
  }
  return backend
}

describe('按画面搜', () => {
  let tree: ReturnType<typeof tempTree>
  let dataDir: string
  let service: LibraryService
  let backend: ReturnType<typeof fakeBackend>

  async function setup(available = true): Promise<void> {
    backend = fakeBackend(available)
    service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: {
        mediaDir: join(dataDir, 'media'),
        // 原图：JPEG 头 + 内容字节 k
        fetch: (async (url: string) => ({
          status: 200,
          url,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: async () =>
            new Uint8Array([0xff, 0xd8, kOf(url)]).buffer,
          text: async () => '',
        })) as never,
      },
      visual: {
        backend,
        pixels: async bytes => new Uint8Array([bytes[2]!]),
      },
    })
    await service.start()
    for (const code of ['SSIS-1', 'SSIS-2', 'SSIS-3']) tree.write(`${code}.mp4`)
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      source: 'jav',
      automation: { identify: false, watch: false },
    })
    await service.queue.idle()
  }

  /** 给条目写元数据：封面与剧照地址（数字即内容）。 */
  function setImages(
    code: string,
    cover: number | null,
    stills: number[]
  ): number {
    const row = service.db
      .prepare('SELECT id FROM media_items WHERE upper(title) = ?')
      .get(code) as { id: number }
    const images = [
      ...(cover === null
        ? []
        : [{ role: 'backdrop', path: `https://img/${cover}.jpg` }]),
      ...stills.map(k => ({ role: 'still', path: `https://img/${k}.jpg` })),
    ]
    service.db
      .prepare('UPDATE media_items SET metadata = ? WHERE id = ?')
      .run(JSON.stringify({ level: 'title', images }), row.id)
    return row.id
  }

  beforeEach(() => {
    tree = tempTree()
    dataDir = mkdtempSync(join(tmpdir(), 'yb-visual-'))
  })
  afterEach(async () => {
    await service.close()
    tree.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('下载模型、建索引，搜索每部取最像的那张图', async () => {
    await setup()
    const a = setImages('SSIS-1', 1, [5, 6])
    const b = setImages('SSIS-2', 2, [7])
    setImages('SSIS-3', null, [])
    expect(await service.visual.status()).toMatchObject({
      runtime: true,
      model: 'missing',
      indexed: 0,
      total: 2,
    })
    expect(service.visual.identifiedFollowups([a])).toEqual([])

    service.visual.index()
    await service.queue.idle()
    expect(backend.downloads).toBe(1)
    expect(await service.visual.status()).toMatchObject({
      model: 'ready',
      indexing: false,
      indexed: 2,
      total: 2,
      error: null,
    })

    expect(await service.visual.search({ text: 'k=6' })).toEqual([
      {
        itemId: a,
        title: expect.any(String),
        score: 1,
        image: 'https://img/6.jpg',
      },
      expect.objectContaining({ itemId: b, score: 0 }),
    ])
    const [top] = await service.visual.search({ text: 'k=7', limit: 1 })
    expect(top).toMatchObject({ itemId: b, image: 'https://img/7.jpg' })

    // 启用后：识别后继会排补索引任务
    expect(service.visual.identifiedFollowups([a])).toHaveLength(1)
  })

  it('图片没变不重建；换了剧照只重建那一部', async () => {
    await setup()
    const a = setImages('SSIS-1', 1, [5])
    setImages('SSIS-2', 2, [7])
    service.visual.index()
    await service.queue.idle()
    const saved = (): number =>
      Number(
        (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM visual_vectors')
            .get() as { n: number }
        ).n
      )
    expect(saved()).toBe(4)

    setImages('SSIS-1', 1, [9])
    service.visual.index()
    await service.queue.idle()
    expect(saved()).toBe(4)
    const [top] = await service.visual.search({ text: 'k=9' })
    expect(top).toMatchObject({ itemId: a, image: 'https://img/9.jpg' })
    expect(await service.visual.search({ text: 'k=5' })).not.toContainEqual(
      expect.objectContaining({ image: 'https://img/5.jpg' })
    )
  })

  it('推理组件不可用：任务失败、状态带原因，搜索拒绝', async () => {
    await setup(false)
    setImages('SSIS-1', 1, [])
    service.visual.index()
    await service.queue.idle()
    const status = await service.visual.status()
    expect(status).toMatchObject({
      runtime: false,
      model: 'missing',
      indexed: 0,
    })
    expect(status.error).toContain('推理组件')
    await expect(service.visual.search({ text: 'k=1' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})
