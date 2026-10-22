/**
 * 下载域的引擎实现：把站点解析、HLS 下载、ffmpeg 转封装接到队列上。
 */
import { spawn } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { NetClient } from '../../shared/net/client'
import { type DownloadSnapshot, download } from '../../shared/contract/download'
import type { EngineContext, EngineHandlers } from '../rpc'
import { directExtension, downloadDirect } from './direct'
import { downloadHls } from './hls'
import { DownloadQueue, type DownloadRunner } from './queue'
import { discardResumeTemps } from './resume'
import { pageGetter, resolveSource } from './sources'

/**
 * 有 ffmpeg 时把 .ts 无损转成 .mp4（-c copy），成功后删 .ts；没有 ffmpeg 或失败保留 .ts。
 * 先写 `.mp4.partial` 再改名：转到一半被打断不会留下看似完整的 .mp4，下次从 .ts 重转。
 * 不打包 ffmpeg：原 Python 下载器引用的 tools/ffmpeg.exe 从未随安装包分发。
 */
export function remuxToMp4(tsFile: string, ffmpeg = 'ffmpeg'): Promise<string> {
  const mp4 = tsFile.replace(/\.ts$/, '.mp4')
  const partial = `${mp4}.partial`
  return new Promise(resolve => {
    const child = spawn(
      ffmpeg,
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        tsFile,
        '-c',
        'copy',
        '-f',
        'mp4',
        partial,
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
      }
    )
    const keepTs = (): void =>
      void rm(partial, { force: true }).then(() => resolve(tsFile))
    child.on('error', keepTs)
    child.on('exit', code => {
      if (code !== 0) return keepTs()
      rename(partial, mp4)
        .then(() => rm(tsFile, { force: true }))
        .then(() => resolve(mp4), keepTs)
    })
  })
}

/** 下载域依赖。 */
export interface DownloadDeps {
  net: NetClient
  /** 队列持久化文件 */
  stateFile: string
  /** 引擎共享上下文：要下载目录、浏览器代抓、推事件 */
  ctx: EngineContext
}

/** 创建下载域 handlers 与队列。 */
export function createDownloadHandlers(deps: DownloadDeps): {
  handlers: EngineHandlers<typeof download>
  queue: DownloadQueue
} {
  const run: DownloadRunner = async (code, report, signal) => {
    const { ctx } = deps
    const dir = join(await ctx.host('downloadDir'), code)
    await mkdir(dir, { recursive: true })
    const source = await resolveSource(
      code,
      pageGetter({
        net: deps.net,
        browserFetch: url => ctx.host('browserFetch', url),
      })
    )
    if (signal.aborted) throw new Error('已取消')
    const options = { referer: source.referer, signal, onProgress: report }
    const out = join(dir, code)
    if (directExtension(source.m3u8)) {
      const { file } = await downloadDirect(deps.net, source.m3u8, out, options)
      return { file, site: source.site }
    }
    const result = await downloadHls(deps.net, source.m3u8, out, options)
    const file =
      result.container === 'ts' ? await remuxToMp4(result.file) : result.file
    return { file, site: source.site }
  }
  // 任务被移除：丢掉续传临时文件（失败 / 取消时它们留着给下次续传）
  const discard = async (code: string): Promise<void> =>
    discardResumeTemps(join(await deps.ctx.host('downloadDir'), code))

  // 进度很密：合并成最多每 500ms 推一次
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: DownloadSnapshot | undefined
  // 忙碌状态不节流：有任务在跑或排队时主进程不能空闲退出引擎
  let busy = false
  const onChange = (snapshot: DownloadSnapshot): void => {
    const nowBusy = Boolean(snapshot.active) || snapshot.queued.length > 0
    if (nowBusy !== busy) {
      busy = nowBusy
      deps.ctx.busy(busy)
    }
    latest = snapshot
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      if (latest) deps.ctx.emit(download, 'changed', latest)
    }, 500)
  }

  const queue = new DownloadQueue({
    file: deps.stateFile,
    run,
    discard,
    onChange,
  })
  return {
    queue,
    handlers: {
      list: () => queue.snapshot(),
      add: (_ctx, code) => queue.add(code),
      remove: (_ctx, code) => queue.remove(code),
      retry: (_ctx, code) => queue.retry(code),
    },
  }
}
