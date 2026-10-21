/**
 * 读外部数据（插件 / CMS / TMDB 返回、localStorage 里的旧记录）时用的类型与收窄：
 * 这些数据的字段都不保证存在，先当 unknown，用到哪个字段再判断类型。
 */

/** 一个 JSON 对象：键已知是字符串，值类型未知 */
export type JsonRecord = Record<string, unknown>

/** 是普通对象（不是数组、不是 null）就返回它，否则 undefined */
export const asRecord = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined

/** 是数组就返回它，否则空数组 */
export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []

/** 字符串原样返回，有限数字转成字符串，其余返回空串 */
export const asText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
