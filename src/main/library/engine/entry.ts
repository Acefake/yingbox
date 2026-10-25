/**
 * 引擎进程入口（Electron utilityProcess）——片库核心的桌面宿主。
 *
 * 启动参数：argv[2] 为数据库文件路径，argv[3] 为图片缓存目录。主进程经 parentPort 按
 * shared/utility/protocol.ts 的线协议发消息：call → 调服务（参数为 args[0]）并回 result；
 * subscribe → 消息附带的 MessagePort 成为事件订阅方，之后事件直接经该端口推给渲染进程；
 * shutdown → 关闭数据库后退出。
 *
 * reply → 主进程对代办（host）的回复：远程源凭据（remote/host-remote.ts）与 AI 识别兜底（host-calls.ts）。
 *
 * 宿主能力（见 platform/platform.ts）：网络用 Electron net.fetch（Chromium 网络栈，走系统代理，
 * 国内访问 TMDB 通常需要），不可用时退回 Node fetch；原图落盘后通知主进程预热缩略图；
 * AI 识别兜底的大模型调用与 ffprobe 定位经 host / reply 请主进程代办（host-calls.ts）。
 * 独立服务（src/server）用同一个 createLibraryService，只是注入 Node 实现。
 */
import { type MessagePortMain, net } from 'electron'
import { join } from 'node:path'
import { LIBRARY_IMAGES_CACHED } from '../../../shared/library/ipc'
import { LIBRARY_ARRIVALS } from '../../../shared/library/arrivals'
import type { FromUtility, ToUtility } from '../../../shared/utility/protocol'
import { hostAi, hostFfprobePath, hostSubtitleSettings } from './host-calls'
import { createStreamProber } from '../subtitles/stream-probe'
import { handleRpc } from './rpc'
import type { HttpFetch } from '../identify/identify-module'
import { createNodeFetch } from '../platform/fetch/node-fetch'
import { createHostCaller, hostRemoteClients } from '../remote/host-remote'
import { createLibraryService, envSecrets } from '../platform/platform'
import { codecDeriver } from '../images/derived'
import { codecClipPixels } from '../visual/clip-pixels'
import { createVideoProber } from '../scanner/video-probe'
import {
  type Codec,
  inProcessCodec,
  startCodec,
} from '../../thumbnails/codec-client'
import { withExplicitReferrer } from '../../../shared/net/referrer'

const dbPath = process.argv[2]
const mediaDir = process.argv[3]
if (!dbPath) {
  console.error('[library] 缺少数据库路径参数')
  process.exit(1)
}

const parentPort = process.parentPort
const post = (message: FromUtility): void => parentPort.postMessage(message)
/** 向主进程代办（远程源凭据、大模型调用）。 */
const host = createHostCaller(post)
const fetchImpl: HttpFetch =
  typeof net?.fetch === 'function'
    ? (((url, init) => net.fetch(url, withExplicitReferrer(init))) as HttpFetch)
    : createNodeFetch()
/**
 * 加工派生图（封面裁海报）的编解码线程：第一次用到才起，和主进程缩略图共用 webp-worker.js；
 * 线程起不来时在引擎线程里做。
 */
let codec: Codec | undefined
const lazyCodec: Codec = (request, transfer) => {
  codec ??=
    startCodec(join(__dirname, 'webp-worker.js'), message =>
      console.warn(`[library] ${message}`)
    ) ?? inProcessCodec()
  return codec(request, transfer)
}

const service = createLibraryService({
  dbPath,
  mediaDir,
  fetch: fetchImpl,
  log: message => console.warn(`[library] ${message}`),
  onImagesCached: keys =>
    post({ kind: 'event', channel: LIBRARY_IMAGES_CACHED, payload: keys }),
  deriveImage: codecDeriver(lazyCodec),
  clipPixels: codecClipPixels(lazyCodec),
  env: envSecrets(process.env),
  ai: hostAi(host),
  // 视频动态范围：ffprobe 路径向主进程要（没有 ffmpeg 时为空串，探测任务直接结束）
  probeVideo: createVideoProber({ binary: hostFfprobePath(host) }),
  // 局域网 NAS / Alist：Node fetch 直连（不走系统代理），凭据每次扫描向主进程要
  remote: hostRemoteClients(host, (url, init) => fetch(url, init)),
  // 新入库交给主进程推送；自动字幕的开关在主进程设置里
  intake: {
    onArrivals: arrivals =>
      post({ kind: 'event', channel: LIBRARY_ARRIVALS, payload: arrivals }),
    subtitleSettings: hostSubtitleSettings(host),
    probeStreams: createStreamProber({ binary: hostFfprobePath(host) }),
  },
})

/** 把一个 MessagePort 接成事件订阅方，端口关闭时自动退订。 */
function attachSubscriber(port: MessagePortMain): void {
  const unsubscribe = service.subscribe(event => port.postMessage(event))
  port.on('close', unsubscribe)
  port.start()
}

let shuttingDown = false
parentPort.on('message', ({ data, ports }) => {
  const message = data as ToUtility
  if (host.settle(message)) return
  switch (message.kind) {
    case 'call':
      void handleRpc(service, {
        method: message.method,
        params: message.args[0],
      }).then(outcome =>
        post(
          outcome.ok
            ? {
                kind: 'result',
                id: message.id,
                ok: true,
                value: outcome.result,
              }
            : {
                kind: 'result',
                id: message.id,
                ok: false,
                error: outcome.error,
              }
        )
      )
      break
    case 'subscribe':
      for (const port of ports) attachSubscriber(port)
      break
    case 'shutdown':
      if (shuttingDown) return
      shuttingDown = true
      void service.close().finally(() => process.exit(0))
      break
  }
})

service.start().then(
  () => post({ kind: 'ready' }),
  error => console.error('[library] 启动失败', error)
)
