/**
 * 桌面端 115 片库：把 115 目录接到媒体库引擎（扫描遍历）与播放协议（内置播放器、mpv 代理）。
 * 引擎在 utilityProcess 里，拿不到 115 登录态，目录列表经主进程代办 pan115Propfind；
 * 播放走 yingbox-dav://pan115/… 由主进程换直链并转发（同 NAS 版的 src/main/pan115/library.ts）。
 * 115 服务晚于媒体库引擎创建，所以先建适配器，服务就绪后再 bindPan115Library。
 */
import type { DavEntry } from '../../shared/webdav/propfind'
import { PAN115_SOURCE, createPan115Library } from './library'
import type { Pan115Service } from './service'

let service: Pan115Service | null = null

const library = createPan115Library(() => service)

/** 115 服务创建好后调用；之前扫描 / 播放 115 库会报「网盘功能未启用」。 */
export function bindPan115Library(next: Pan115Service): void {
  service = next
}

/** 媒体库引擎的代办方法（与 webdavHostMethods 合并后交给 registerLibraryIpc）。 */
export const pan115HostMethods = {
  pan115Propfind: async (path: string, depth: 0 | 1): Promise<DavEntry[]> =>
    (await library.remote(PAN115_SOURCE)).propfind(path, depth),
}

/** 播放代理用的专用源：yingbox-dav://pan115/… 交给 115 适配器。 */
export const pan115Source = {
  id: PAN115_SOURCE,
  stream: library.stream,
}
