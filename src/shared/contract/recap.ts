import type {
  RecapContext,
  RecapPrepareOptions,
  RecapProbe,
  RecapProbeOptions,
  RecapSaveOptions,
} from '../recap/types'
import { ContractError, call, defineDomain, record, str } from './define'

/** 前情提要正文上限（字符） */
const MAX_RECAP_CHARS = 4000

/** 校验探测选项 */
export function parseProbeOptions(raw: unknown): RecapProbeOptions {
  if (raw == null) return {}
  const input = record<Record<string, unknown>>(raw, 'options')
  return input.private === true ? { private: true } : {}
}

/** 校验请求标识（字母数字与连字符，最长 64） */
export function parseRequestId(raw: unknown, name = 'requestId'): string {
  const id = str(raw, name)
  if (!/^[\w-]{1,64}$/.test(id)) throw new ContractError(`参数 ${name} 不合法`)
  return id
}

/** 校验 prepare 选项（只保留认识的字段） */
export function parsePrepareOptions(raw: unknown): RecapPrepareOptions {
  const input = record<Record<string, unknown>>(raw, 'options')
  if (input.purpose !== 'recap' && input.purpose !== 'qa')
    throw new ContractError('参数 options.purpose 不合法')
  const options: RecapPrepareOptions = {
    purpose: input.purpose,
    ...parseProbeOptions(input),
  }
  if (input.purpose === 'qa') {
    const seconds = input.seconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0)
      throw new ContractError('参数 options.seconds 应为非负数')
    options.seconds = seconds
  }
  if (input.requestId !== undefined)
    options.requestId = parseRequestId(input.requestId, 'options.requestId')
  return options
}

/** 校验保存参数 */
export function parseSaveOptions(raw: unknown): RecapSaveOptions {
  const input = record<Record<string, unknown>>(raw, 'options')
  const cacheKey = str(input.cacheKey, 'options.cacheKey')
  if (!/^recap:[\da-f]{16}$/.test(cacheKey))
    throw new ContractError('参数 options.cacheKey 不合法')
  const text = str(input.text, 'options.text').trim()
  if (!text) throw new ContractError('参数 options.text 不能为空')
  return {
    cacheKey,
    text: text.slice(0, MAX_RECAP_CHARS),
    ...parseProbeOptions(input),
  }
}

/**
 * 前情提要 / 问剧情的素材（实现见 src/main/recap）：只接受 local:// 地址。
 * 主进程负责找同目录之前几集、读字幕 / 分集简介、分段摘要并按集缓存；
 * 最终的流式生成在渲染层经 ai.chat 发出（提示词见 shared/recap/prompts）。
 */
export const recap = defineDomain('recap', {
  /** 开播时的轻量探测：是不是剧集、之前几集有没有素材、有没有已缓存的前情提要（不调模型） */
  probe: call<[localUrl: string, options: RecapProbeOptions], RecapProbe>(a => [
    str(a[0], 'localUrl'),
    parseProbeOptions(a[1]),
  ]),
  /** 准备上下文：之前各集摘要（缺的现算并缓存）；问剧情再加本集进度之前的部分 */
  prepare: call<[localUrl: string, options: RecapPrepareOptions], RecapContext>(
    a => [str(a[0], 'localUrl'), parsePrepareOptions(a[1])]
  ),
  /** 取消本窗口发起、还在跑的 prepare（按 requestId）；返回是否找到并取消 */
  cancel: call<[requestId: string], boolean>(a => [parseRequestId(a[0])]),
  /** 生成完的前情提要按集缓存 */
  save: call<[options: RecapSaveOptions], void>(a => [parseSaveOptions(a[0])]),
})
