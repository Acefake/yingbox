/**
 * mpv 经 IPC 推来的事件如何改影盒这边的状态：属性变化进状态、换片 / 放完 / 重开时刷新增强、
 * 窗口里的快捷键消息、换片保护握手，以及「没文件在放」时回到待命。进程与状态归 MpvPlayer，这里经 {@link EventHost} 读写。
 */
import type { ChildProcess } from 'child_process'
import type { MpvEnhancement } from './mpv-enhancement'
import type { MpvImageEnhance } from './mpv-enhance'
import { COMPACT_MESSAGE, patchStatus } from './mpv-props'
import type { MpvStatus } from '../shared/mpv'

export const warnProp = (error: unknown): void =>
  console.warn('[mpv] 换片前设置属性失败，照样换片：', error)

export const warnEnhancement = (error: unknown): void =>
  console.warn('[mpv] 更新增强状态失败：', error)

export interface EventHost {
  status(): MpvStatus
  /** 把当前状态推给渲染层 */
  publish(): void
  emit(event: string, ...args: unknown[]): void
  enhancement: MpvEnhancement
  imageEnhance: MpvImageEnhance
  /** 有文件在放（窗口开着） */
  active(): boolean
  /** 没文件在放了：回到待命 */
  goIdle(): void
  /** 窗口出现了：顶到最前 */
  bringToFront(): Promise<void>
  compact(): boolean
  setCompact(on: boolean): Promise<void>
  child(): ChildProcess | null
  connected(): boolean
  cmd(...args: unknown[]): Promise<unknown>
}

/** 处理一条 mpv 事件 */
export function routeMpvEvent(
  h: EventHost,
  msg: Record<string, unknown>
): void {
  const args =
    msg.event === 'client-message' && Array.isArray(msg.args) ? msg.args : null
  if (args?.[0] === 'yingbox-enhance-toggle') {
    void h.imageEnhance.toggle().catch(warnProp)
  } else if (args?.[0] === 'yingbox-vsr-load') {
    const [, id, script] = args
    if (
      typeof id === 'string' &&
      /^\d+$/.test(id) &&
      typeof script === 'string' &&
      /^[\w-]+$/.test(script)
    )
      void continueVsrLoad(h, id, script)
  } else if (args?.[0] === COMPACT_MESSAGE) {
    void h.setCompact(!h.compact()).catch(() => {})
  } else if (msg.event === 'property-change') {
    applyProp(h, msg.name as string, msg.data)
  } else if (msg.event === 'end-file') {
    h.status().loading = false
    h.publish()
    h.emit('end-file', msg.reason)
  } else if (msg.event === 'start-file') {
    void h.enhancement.prepareFile().catch(warnEnhancement)
    h.status().loading = true
    h.publish()
    h.emit('start-file')
  } else if (msg.event === 'file-loaded') {
    void h.enhancement.startFile().catch(warnEnhancement)
  } else if (msg.event === 'playback-restart') {
    void h.enhancement.refresh().catch(warnEnhancement)
    h.status().loading = false
    h.publish()
  }
}

function applyProp(h: EventHost, name: string, data: unknown): void {
  if (name === 'vo-configured') {
    if (data === true && h.active()) void h.bringToFront()
    return
  }
  if (name === 'idle-active') {
    if (data === true && h.active()) h.goIdle()
    return
  }
  if (!h.enhancement.update(name, data)) patchStatus(h.status(), name, data)
  if (name === 'video-dec-params')
    void h.imageEnhance.onParams(data).catch(warnProp)
  h.publish()
}

/** 换片保护握手：先把增强准备好，再通知 Lua 钩子继续加载 */
async function continueVsrLoad(
  h: EventHost,
  id: string,
  script: string
): Promise<void> {
  const child = h.child()
  if (!child) return
  const same = (): boolean => h.child() === child && h.connected()
  try {
    await h.enhancement.prepareFile()
  } catch (error) {
    warnEnhancement(error)
    if (same()) await h.cmd('stop').catch(warnEnhancement)
  } finally {
    if (same())
      await h
        .cmd('script-message-to', script, 'yingbox-vsr-continue', id)
        .catch(warnEnhancement)
  }
}
