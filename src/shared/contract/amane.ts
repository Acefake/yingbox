import type { AmaneRequest, AmaneSettings, AmaneStatus } from '../amane'
import { call, defineDomain, int, record } from './define'

/** amane.configure 的入参：可改的设置 + 可选的新令牌 */
export type AmaneConfigureInput = Partial<
  Omit<AmaneSettings, 'tokenConfigured'>
> & { token?: string }

/** Amane 后台（独立 GPL 程序）的生命周期与 API 转发。 */
export const amane = defineDomain('amane', {
  /** 当前状态（运行中会顺带做一次健康检查） */
  status: call<AmaneStatus>(),
  /** 启动由影盒管理的后台 */
  start: call<AmaneStatus>(),
  /** 停止后台 */
  stop: call<AmaneStatus>(),
  /** 修改连接设置（需先停止后台） */
  configure: call<[settings: AmaneConfigureInput], AmaneStatus>(a => [
    record<AmaneConfigureInput>(a[0], 'settings'),
  ]),
  /** 选择后台可执行文件 */
  selectExecutable: call<string | null>(),
  /** 转发一次 Amane API 请求，返回解析后的 JSON */
  request: call<[request: AmaneRequest], unknown>(a => [
    record<AmaneRequest>(a[0], 'request'),
  ]),
  /** 解析媒体 ID 对应的本地文件路径（交给统一播放器，遵循播放引擎设置） */
  resolveMedia: call<
    [mediaId: number],
    { success: boolean; filePath?: string; error?: string }
  >(a => [int(a[0], 'mediaId')]),
  /** 手机接入信息：当前服务的 baseUrl 与 API token */
  connection: call<{ baseUrl: string; token: string }>(),
})
