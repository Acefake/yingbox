/**
 * 唯一 IPC 契约：加一个接口只改对应域的文件。
 *
 * 主进程用 `implement(域, handlers)` 注册（src/main/rpc），preload 按本表生成 `window.api`，
 * 渲染层的 `window.api` 类型由 {@link Api} 推导。
 */
import { app } from './app'
import { av } from './av'
import { capture } from './capture'
import { danmaku } from './danmaku'
import type { ApiOf } from './define'
import { dialog } from './dialog'
import { download } from './download'
import { lada } from './lada'
import { libraryNotify } from './library-notify'
import { media } from './media'
import { mpv } from './mpv'
import { online } from './online'
import { settings } from './settings'
import { shell } from './shell'
import { subtitle } from './subtitle'
import { update } from './update'
import { win } from './win'

/** 全部域，键与域名一致 */
export const contract = {
  app,
  av,
  capture,
  danmaku,
  dialog,
  download,
  lada,
  libraryNotify,
  media,
  mpv,
  online,
  settings,
  shell,
  subtitle,
  update,
  win,
} as const

/** 渲染层 `window.api` 的类型 */
export type Api = ApiOf<typeof contract>
