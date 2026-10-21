/**
 * 配置表单单个字段的纯规则：显隐、单行布局、密钥字段、选项文字，
 * 以及字典 / 数组的不可变增删改与输入值换算。
 */
import { type Schema, type Value, text } from './config-schema'

/** 路径里含这些段的字段按密码框显示 */
export const isSecretPath = (path: string): boolean =>
  /(?:^|\.)(?:api_key|api_token|password|cookie|dsn)(?:\.|$)/.test(path)

/** x-hidden，或字典条目不在 x-visible-keys 里时隐藏 */
export function isHiddenField(schema: Schema, dictKey?: string): boolean {
  return Boolean(
    schema['x-hidden'] ||
    (Array.isArray(schema['x-visible-keys']) &&
      dictKey &&
      !(schema['x-visible-keys'] as string[]).includes(dictKey))
  )
}

/**
 * 单值字段（开关、枚举、数字、短文本）用系统设置式的一行：标题在左、控件在右；
 * 嵌套对象、字典、数组和长文本仍然上下排列。
 */
export function isInlineField(schema: Schema, bare?: boolean): boolean {
  return (
    !bare &&
    !schema['x-long'] &&
    (schema.type === 'boolean' ||
      Boolean(schema.enum) ||
      ['number', 'integer', 'string'].includes(schema.type || ''))
  )
}

/** 选项文字：翻译 > x-show-names > 原值 */
export function optionLabel(
  path: string,
  value: Value,
  node: Schema,
  index: number
): string {
  return text(
    path,
    `options.${value}`,
    (node['x-show-names'] as string[] | undefined)?.[index] || String(value)
  )
}

/** 把值当对象读（不是普通对象时为空对象） */
export const asObject = (value: Value): Record<string, Value> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** 把值当数组读（不是数组时为空数组） */
export const asArray = (value: Value): Value[] =>
  Array.isArray(value) ? value : []

/** 字典能否添加这个键：非空、不是原型链关键字、不重复 */
export function canAddKey(key: string, object: Record<string, Value>): boolean {
  return (
    Boolean(key) &&
    !['__proto__', 'prototype', 'constructor'].includes(key) &&
    !Object.hasOwn(object, key)
  )
}

/** 去掉字典的一个键（返回新对象） */
export function withoutKey(
  object: Record<string, Value>,
  key: string
): Record<string, Value> {
  const next = { ...object }
  delete next[key]
  return next
}

/** 当前选中的字典条目：选中的键还在就用它，否则第一个 */
export const activeDictKey = (
  object: Record<string, Value>,
  selected: string
): string =>
  Object.hasOwn(object, selected) ? selected : Object.keys(object)[0] || ''

/** 替换数组第 index 项（返回新数组） */
export function replaceAt(
  items: Value[],
  index: number,
  value: Value
): Value[] {
  const next = [...items]
  next[index] = value
  return next
}

/** 把第 from 项移到 to；越界时返回 null（不改动） */
export function moveItem(
  items: Value[],
  from: number,
  to: number
): Value[] | null {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return null
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** 多选：有则去掉，无则追加 */
export const toggleItem = (items: Value[], option: Value): Value[] =>
  items.includes(option)
    ? items.filter(item => item !== option)
    : [...items, option]

/** 下拉框的字符串值 → 枚举里的原始值；可空字段选空时为 null */
export function enumValue(schema: Schema, raw: string): Value {
  if (raw === '' && schema.nullable) return null
  return schema.enum?.find(option => String(option) === raw) ?? raw
}

/** 数字框输入：清空为 null，非法输入返回 undefined（不更新） */
export function numberValue(raw: string, asNumber: number): Value | undefined {
  if (raw === '') return null
  return Number.isFinite(asNumber) ? asNumber : undefined
}
