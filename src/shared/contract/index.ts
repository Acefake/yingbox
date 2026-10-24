/**
 * 唯一 IPC 契约：加一个接口只改对应域的文件。
 *
 * 主进程用 `implement(域, handlers)` 注册（src/main/rpc），preload 按本表生成 `window.api`，
 * 渲染层的 `window.api` 类型由 {@link Api} 推导。
 */
import { ai } from './ai'
import { app } from './app'
import { av } from './av'
import { capture } from './capture'
import { danmaku } from './danmaku'
import type { ApiOf } from './define'
import { dialog } from './dialog'
import { download } from './download'
import { introDetect } from './intro-detect'
import { iptv } from './iptv'
import { lada } from './lada'
import { libraryNotify } from './library-notify'
import { media } from './media'
import { mpv } from './mpv'
import { nowPlaying } from './now-playing'
import { online } from './online'
import { sectionLock } from './section-lock'
import { settings } from './settings'
import { shell } from './shell'
import { subtitle } from './subtitle'
import { update } from './update'
import { webdav } from './webdav'
import { win } from './win'

/** 全部域，键与域名一致 */
export const contract = {
  ai,
  app,
  av,
  capture,
  danmaku,
  dialog,
  download,
  introDetect,
  iptv,
  lada,
  libraryNotify,
  media,
  mpv,
  nowPlaying,
  online,
  sectionLock,
  settings,
  shell,
  subtitle,
  update,
  webdav,
  win,
} as const

/** 渲染层 `window.api` 的类型 */
export type Api = ApiOf<typeof contract>
