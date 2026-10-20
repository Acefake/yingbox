/**
 * Amane 插件入口：加载连接设置、注册 amane:// 协议与 amane 域、登记到插件宿主。
 *
 * 职责拆分：rules（纯规则）/ connection（设置与令牌）/ service（进程生命周期）/ api（转发）。
 */
import { dialog, protocol } from 'electron'
import type { AmaneStatus } from '../../../shared/amane'
import { type AmaneConfigureInput, amane } from '../../../shared/contract/amane'
import { implement } from '../../rpc'
import { registerThumbSource } from '../../thumbnails'
import { registerPlugin } from '../host'
import { imageResponse, requestApi, resolveAmaneMedia } from './api'
import { connection, loadConnection, persist } from './connection'
import { applyConfigure } from './rules'
import {
  checkHealth,
  service,
  shutdown,
  snapshot,
  startService,
  stopChild,
} from './service'

/** 修改连接设置：校验 → 持久化（失败回滚） → 状态复位 */
async function configure(changes: AmaneConfigureInput): Promise<AmaneStatus> {
  if (service.starting || service.child)
    throw new Error('请先停止由影盒管理的 Amane 后台，再修改连接设置')
  const { next, token } = applyConfigure(connection.settings, changes)
  const previous = connection.settings
  const previousToken = connection.token
  connection.settings = next
  if (token !== undefined) connection.token = token
  try {
    await persist()
  } catch (error) {
    connection.settings = previous
    connection.token = previousToken
    throw error
  }
  service.state = 'stopped'
  service.failure = ''
  service.version = undefined
  return snapshot()
}

export async function registerAmaneIpc(): Promise<void> {
  const loadError = await loadConnection()
  if (loadError) {
    service.state = 'error'
    service.failure = loadError
  }
  protocol.handle('amane', imageResponse)
  // 缩略图服务取 Amane 资源图的原图时直接走同一个处理函数（Amane 在本机，不能经外网 SSRF 防护）
  registerThumbSource('amane:', source => imageResponse(new Request(source)))
  implement(amane, {
    status: async () => {
      if (service.state === 'running') {
        try {
          await checkHealth()
        } catch (error) {
          service.state = 'error'
          service.failure = (error as Error).message
        }
      }
      return snapshot()
    },
    start: () => startService(),
    stop: async () => {
      if (service.starting) await service.starting
      await stopChild()
      service.state = 'stopped'
      service.failure = ''
      return snapshot()
    },
    configure: (_, changes) => configure(changes),
    selectExecutable: async () => {
      const result = await dialog.showOpenDialog({
        title: '选择 Amane 后台程序',
        properties: ['openFile'],
        filters: [
          {
            name: 'Amane.Server',
            extensions: process.platform === 'win32' ? ['exe'] : ['*'],
          },
        ],
      })
      return result.canceled ? null : result.filePaths[0] || null
    },
    request: (_, request) => requestApi(request),
    // 仅解析路径，不直接开播放窗：播放引擎（内置 / mpv）由渲染层统一决定。
    resolveMedia: async (_, mediaId) => {
      try {
        return { success: true, filePath: await resolveAmaneMedia(mediaId) }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    },
    // 手机接入:把当前服务的 baseUrl + token 交给渲染层,由"手机访问"面板生成接入链接。
    connection: () => ({
      baseUrl: connection.settings.baseUrl,
      token: connection.token || '',
    }),
  })
  registerPlugin({
    id: 'Amane',
    stop: shutdown,
    // 托管进程存在或正在启动都算运行；外部服务模式不归影盒管
    health: () => ({
      running:
        service.child !== null ||
        service.starting !== null ||
        service.restartTimer !== null,
      detail: service.failure || service.state,
    }),
  })
}
