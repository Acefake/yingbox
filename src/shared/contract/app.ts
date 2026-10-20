import { call, defineDomain } from './define'
import type { FileResult } from './file'

/** 应用信息。 */
export const app = defineDomain('app', {
  /** userData 目录 */
  getUserDataPath: call<string>(),
  /** 本机非回环 IPv4 地址（手机接入用） */
  networkIps: call<string[]>(),
  /** package.json 里的名称、版本等 */
  getVersion: call<FileResult>(),
})
