/**
 * 媒体库前端访问片库的唯一入口：按运行环境选 transport，界面代码不关心是哪一种。
 *
 * - 桌面端：window.api.library（preload 注入，IPC + MessagePort）；
 * - 网页端：createHttpLibraryBridge（HTTP RPC + SSE，连独立片库服务，见 services/library-server）。
 * 两者实现同一个 LibraryBridge 接口。旧版 preload（有 window.api 却没有 library）返回 null，
 * 调用方据此显示“不可用”的空状态。
 */
import { watch } from 'vue'
import type {
  LibraryBridge,
  LibraryWriterBridge,
} from '../../../../../shared/library/ipc'
import {
  isWebRuntime,
  libraryServerState,
  serverFetch,
} from '@/services/library-server'
import { type HttpLibraryBridge, createHttpLibraryBridge } from './http-bridge'

let webBridge: HttpLibraryBridge | null = null

/**
 * 网页端 transport：服务没就绪（连不上 / 未登录）时关掉事件流，别让浏览器无限重连（就绪后断线照常自动重连）；
 * 服务回到在线时把还有订阅的事件流重新打开，片库事件不会就此断掉。
 */
function createWebLibraryBridge(): HttpLibraryBridge {
  const created = createHttpLibraryBridge({
    request: serverFetch,
    openEvents: (url, onData, onClosed) => {
      const source = new EventSource(url, { withCredentials: true })
      source.onmessage = event => onData(String(event.data))
      source.onerror = () => {
        if (libraryServerState().value === 'online') return
        source.close()
        onClosed()
      }
      return source
    },
  })
  watch(libraryServerState(), state => {
    if (state === 'online') created.resume()
  })
  return created
}

/** 当前窗口的媒体库 bridge。 */
export function libraryBridge(): LibraryBridge | null {
  if (typeof window === 'undefined') return null
  if (window.api) return window.api.library ?? null
  if (!isWebRuntime()) return null
  webBridge ??= createWebLibraryBridge()
  return webBridge
}

/** 写出层 bridge（NFO / 图片 / 整理）。没有 bridge 时返回 null，界面把相关入口置灰。 */
export function writerBridge(): LibraryWriterBridge | null {
  return libraryBridge()?.writer ?? null
}

/** 是否经 HTTP 连独立片库服务（网页端）：目录选择、播放、令牌设置据此换成网页实现。 */
export function usesLibraryServer(): boolean {
  return isWebRuntime()
}

/** 引擎错误消息形如 “[library:code] 原因”，界面只显示原因。 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^\[library:[a-z-]+\]\s*/, '')
}
