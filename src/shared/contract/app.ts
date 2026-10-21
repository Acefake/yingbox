import { call, defineDomain } from './define'

/** 应用信息。 */
export const app = defineDomain('app', {
  /** 本机非回环 IPv4 地址（手机接入用） */
  networkIps: call<string[]>(),
})
