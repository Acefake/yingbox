/**
 * 海报取景的焦点服务（宿主无关，桌面端与独立服务共用）：按图片地址给焦点，随缩略图缓存持久化。
 *
 * - 存放：<mediaDir>/thumb/<前两位>/<key>.focus.json，与缩略图同一个 LRU（淘汰了就重算）；
 * - 生成缩略图时顺手算（observe）：只算会被竖版海报框裁掉的图（宽高比 ≥ EAGER_ASPECT），
 *   竖海报进竖框不裁，不必算；有人在等这张的焦点时不论比例都算；
 * - 问到没有焦点的图：取已有的缩略图（任一档，没有就生成 300 宽）解码后算；
 * - 计算都在编解码线程里（codec 'focus'），一次只算一张（限速），不占宿主事件循环；
 * - 渲染层 FaceDetector 的结果经 save 写回，by = 'face' 的记录不随算法版本作废。
 */
import { readFile } from 'node:fs/promises'
import {
  FOCUS_VERSION,
  type MediaFocus,
  parseFocus,
} from '../../../shared/media-focus'
import { type MediaTarget, parseMediaUrl } from '../../../shared/media-url'
import type { ThumbCache } from '../cache'
import type { Codec } from '../codec-client'
import { focusName, targetKey } from '../paths'
import type { ResizedImage, ThumbFile } from '../thumbnailer'

/** 宽高比达到它的图生成缩略图时就算焦点（2:3 竖框会裁掉它的左右）。 */
const EAGER_ASPECT = 0.75

/** 依赖。 */
export interface FocusServiceDeps {
  cache: ThumbCache
  /** 编解码线程；没有时不算焦点（全部返回 null）。 */
  codec: Codec | undefined
  /** 这张图已有的或现生成的缩略图；原图取不到返回 null。 */
  thumbnail(target: MediaTarget): Promise<ThumbFile | null>
  log: (message: string) => void
}

/** 地址 → 缓存 key（与缩略图同一算法）；不是媒体地址返回 null。 */
function targetOf(url: string): { key: string; target: MediaTarget } | null {
  const target = parseMediaUrl(url)
  return target ? { key: targetKey(target), target } : null
}

/** 焦点服务。 */
export class FocusService {
  /** 按 key 在途的查询（同一张图并发只算一次）。 */
  private readonly inflight = new Map<string, Promise<MediaFocus | null>>()
  /** 生成缩略图时顺手开始的计算。 */
  private readonly fromPixels = new Map<string, Promise<MediaFocus | null>>()
  /** 解码 + 计算排成一队，一次一张。 */
  private tail: Promise<unknown> = Promise.resolve()
  /** 同一图片的写入有序，人脸检测结果不被较晚的启发式计算降级。 */
  private readonly writes = new Map<string, Promise<MediaFocus>>()

  constructor(private readonly deps: FocusServiceDeps) {}

  /** 这些地址的焦点（按顺序）；不是缩略图地址、原图取不到、没有编解码线程时为 null。 */
  get(urls: readonly string[]): Promise<Array<MediaFocus | null>> {
    return Promise.all(
      urls.map(url => {
        const parsed = targetOf(url)
        return parsed ? this.ensure(parsed.key, parsed.target) : null
      })
    )
  }

  /** 写回一条焦点（渲染层的人脸检测结果）；地址或焦点不合法时抛错。 */
  async save(url: string, focus: MediaFocus): Promise<void> {
    const parsed = targetOf(url)
    const valid = parseFocus(focus)
    if (!parsed) throw new Error('不是缩略图地址')
    if (!valid) throw new Error('焦点不合法')
    await this.write(parsed.key, valid)
  }

  /** 缩略图管线缩放出像素时调用（同步复制像素，计算放进编解码线程）。 */
  readonly observe = (key: string, image: ResizedImage): void => {
    if (!this.deps.codec || this.fromPixels.has(key)) return
    const wanted = this.inflight.has(key)
    if (!wanted && image.width / image.height < EAGER_ASPECT) return
    const rgba = image.rgba.slice()
    const job = this.queued(async () => {
      if (!wanted && (await this.read(key))) return null
      return this.analyze(key, rgba, image.width, image.height)
    }).finally(() => this.fromPixels.delete(key))
    this.fromPixels.set(key, job)
  }

  /** 在途计算是否都已结束（测试用）。 */
  async idle(): Promise<void> {
    while (this.inflight.size || this.fromPixels.size || this.writes.size)
      await Promise.allSettled([
        ...this.inflight.values(),
        ...this.fromPixels.values(),
        ...this.writes.values(),
      ])
  }

  private ensure(key: string, target: MediaTarget): Promise<MediaFocus | null> {
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.compute(key, target)
        .catch(error => {
          this.deps.log(`计算海报焦点失败 ${key}：${(error as Error).message}`)
          return null
        })
        .finally(() => this.inflight.delete(key))
      this.inflight.set(key, pending)
    }
    return pending
  }

  private async compute(
    key: string,
    target: MediaTarget
  ): Promise<MediaFocus | null> {
    const stored = await this.read(key)
    if (stored || !this.deps.codec) return stored
    const thumb = await this.deps.thumbnail(target)
    if (!thumb) return null
    // 缩略图是刚生成的：observe 已经拿到像素在算了
    const started = this.fromPixels.get(key)
    if (started) return (await started) ?? this.read(key)
    return (
      (await this.read(key)) ?? this.queued(() => this.fromFile(key, thumb))
    )
  }

  /** 解码缓存里的缩略图再算。 */
  private async fromFile(
    key: string,
    thumb: ThumbFile
  ): Promise<MediaFocus | null> {
    const codec = this.deps.codec!
    const bytes = new Uint8Array(await readFile(thumb.path))
    const transfer = [bytes.buffer as ArrayBuffer]
    const image =
      thumb.contentType === 'image/webp'
        ? await codec({ op: 'decode', bytes }, transfer)
        : await codec({ op: 'resize', bytes, width: 300 }, transfer)
    if (!image.width || !image.height) return null
    return this.analyze(key, image.data, image.width, image.height)
  }

  private async analyze(
    key: string,
    rgba: Uint8Array,
    width: number,
    height: number
  ): Promise<MediaFocus> {
    const { focus } = await this.deps.codec!(
      { op: 'focus', rgba, width, height },
      [rgba.buffer as ArrayBuffer]
    )
    return this.write(key, focus)
  }

  private queued<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task)
    this.tail = run.catch(() => {})
    return run
  }

  /** 读缓存里的焦点；没有、坏了、启发式结果的版本旧了返回 null。 */
  private async read(key: string): Promise<MediaFocus | null> {
    const path = await this.deps.cache.find(focusName(key))
    if (!path) return null
    try {
      const focus = parseFocus(JSON.parse(await readFile(path, 'utf8')))
      return focus && (focus.by === 'face' || focus.v === FOCUS_VERSION)
        ? focus
        : null
    } catch {
      return null
    }
  }

  private write(key: string, focus: MediaFocus): Promise<MediaFocus> {
    const previous = this.writes.get(key) ?? Promise.resolve()
    const run = previous
      .catch(() => {})
      .then(async () => {
        const stored = await this.read(key)
        if (stored?.by === 'face' && focus.by !== 'face') return stored
        await this.deps.cache.put(
          focusName(key),
          Buffer.from(JSON.stringify(focus))
        )
        return focus
      })
    this.writes.set(key, run)
    void run
      .finally(() => {
        if (this.writes.get(key) === run) this.writes.delete(key)
      })
      .catch(() => {})
    return run
  }
}
