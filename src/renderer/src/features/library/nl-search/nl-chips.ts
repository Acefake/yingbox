/**
 * 自然语言搜索的条件胶囊：NlFilter → 一排可删、可改的胶囊，以及删 / 改 / 切换后的新条件。
 *
 * 每次操作返回新对象（不改入参），删光的字段直接去掉。纯函数，便于测试。
 */
import type { LibrarySection } from '../state/library-section'
import type { NlFilter } from './nl-filter'
import { typeConflicts } from './nl-rules'

/** 胶囊对应的字段。years 合并 yearFrom / yearTo。 */
export type NlChipField =
  | 'type'
  | 'genres'
  | 'years'
  | 'ratingMin'
  | 'people'
  | 'countries'
  | 'watched'
  | 'sort'
  | 'keywords'

/** 胶囊怎么改：text 弹输入框改值，toggle 点一下切换，none 只能删。 */
export type NlChipEdit = 'text' | 'toggle' | 'none'

/** 一个条件胶囊。 */
export interface NlChip {
  /** 列表内唯一（字段 + 取值） */
  key: string
  field: NlChipField
  /** 多值字段里的那个值 */
  value?: string
  /** 字段名（灰字） */
  name: string
  /** 取值显示 */
  label: string
  edit: NlChipEdit
  /** 改值输入框的初始文字 */
  draft: string
  /** 本页用不上（如电影页里的「剧集」），查询时忽略 */
  inactive?: boolean
}

/** 常见国家 / 地区代码的中文名。 */
const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国大陆',
  HK: '中国香港',
  TW: '中国台湾',
  KR: '韩国',
  JP: '日本',
  US: '美国',
  GB: '英国',
  FR: '法国',
  DE: '德国',
  IT: '意大利',
  ES: '西班牙',
  IN: '印度',
  TH: '泰国',
  CA: '加拿大',
  AU: '澳大利亚',
  RU: '俄罗斯',
}

/** 国家代码 → 中文名（不认识的原样）。 */
export const countryLabel = (code: string): string =>
  COUNTRY_NAMES[code] ?? code

/** 中文名或代码 → 代码；认不出返回 null。 */
export function countryCode(text: string): string | null {
  const t = text.trim()
  const upper = t.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return upper
  const hit = Object.entries(COUNTRY_NAMES).find(
    ([, name]) => name === t || name.endsWith(t) || t.endsWith(name)
  )
  return hit ? hit[0] : null
}

const SORT_LABEL: Record<string, [string, string]> = {
  rating: ['评分从低到高', '评分从高到低'],
  year: ['年份从早到晚', '年份从新到旧'],
  addedAt: ['最早添加', '最近添加'],
  title: ['片名 A→Z', '片名 Z→A'],
}

/** 年份范围的文字：1990–1999 / 2010 年以后 / 2000 年以前（copy-lint: ok） */
export function yearsLabel(from?: number, to?: number): string {
  if (from !== undefined && to !== undefined)
    return from === to ? `${from} 年` : `${from}–${to}`
  if (from !== undefined) return `${from} 年以后`
  return `${to} 年以前` // 年份范围的说法，copy-lint: ok
}

const multi = (
  field: 'genres' | 'people' | 'countries' | 'keywords',
  name: string,
  values: string[] | undefined,
  label: (v: string) => string = v => v
): NlChip[] =>
  (values ?? []).map(value => ({
    key: `${field}:${value}`,
    field,
    value,
    name,
    label: label(value),
    edit: 'text',
    draft: label(value),
  }))

/** 条件 → 胶囊（顺序：类别、类型、年代、评分、人物、地区、观看、片名、排序）。 */
export function nlChips(filter: NlFilter, section: LibrarySection): NlChip[] {
  const chips: NlChip[] = []
  if (filter.type) {
    const inactive = typeConflicts(section, filter)
    chips.push({
      key: 'type',
      field: 'type',
      name: '类别',
      label: filter.type === 'movie' ? '电影' : '剧集',
      edit: 'none',
      draft: '',
      ...(inactive ? { inactive } : {}),
    })
  }
  chips.push(...multi('genres', '类型', filter.genres))
  if (filter.yearFrom !== undefined || filter.yearTo !== undefined) {
    const label = yearsLabel(filter.yearFrom, filter.yearTo)
    chips.push({
      key: 'years',
      field: 'years',
      name: '年代',
      label,
      edit: 'text',
      draft: `${filter.yearFrom ?? ''}-${filter.yearTo ?? ''}`,
    })
  }
  if (filter.ratingMin !== undefined)
    chips.push({
      key: 'ratingMin',
      field: 'ratingMin',
      name: '评分',
      label: `≥ ${filter.ratingMin}`,
      edit: 'text',
      draft: String(filter.ratingMin),
    })
  chips.push(...multi('people', '人物', filter.people))
  chips.push(...multi('countries', '地区', filter.countries, countryLabel))
  if (filter.watched !== undefined)
    chips.push({
      key: 'watched',
      field: 'watched',
      name: '观看',
      label: filter.watched ? '看过或在看' : '没看过',
      edit: 'toggle',
      draft: '',
    })
  chips.push(...multi('keywords', '片名含', filter.keywords))
  if (filter.sort)
    chips.push({
      key: 'sort',
      field: 'sort',
      name: '排序',
      label: SORT_LABEL[filter.sort.field][filter.sort.order === 'asc' ? 0 : 1],
      edit: 'toggle',
      draft: '',
    })
  return chips
}

/** 从多值字段里去掉 / 替换一个值；空了就去掉字段。 */
function replaceValue(
  filter: NlFilter,
  field: 'genres' | 'people' | 'countries' | 'keywords',
  value: string | undefined,
  next: string | null
): NlFilter {
  const list = (filter[field] ?? []).flatMap(v =>
    v === value ? (next ? [next] : []) : [v]
  )
  const out = { ...filter }
  const unique = [...new Set(list)]
  if (unique.length) out[field] = unique
  else delete out[field]
  return out
}

/** 去掉年份范围。 */
function withoutYears(filter: NlFilter): NlFilter {
  const out = { ...filter }
  delete out.yearFrom
  delete out.yearTo
  return out
}

/** 删掉一个胶囊对应的条件。 */
export function removeChip(filter: NlFilter, chip: NlChip): NlFilter {
  switch (chip.field) {
    case 'genres':
    case 'people':
    case 'countries':
    case 'keywords':
      return replaceValue(filter, chip.field, chip.value, null)
    case 'years':
      return withoutYears(filter)
    default: {
      const out = { ...filter }
      delete out[chip.field]
      return out
    }
  }
}

/** 点一下切换：观看状态取反、排序方向取反；其余不变。 */
export function toggleChip(filter: NlFilter, chip: NlChip): NlFilter {
  if (chip.field === 'watched' && filter.watched !== undefined)
    return { ...filter, watched: !filter.watched }
  if (chip.field === 'sort' && filter.sort)
    return {
      ...filter,
      sort: {
        ...filter.sort,
        order: filter.sort.order === 'asc' ? 'desc' : 'asc',
      },
    }
  return filter
}

/** 「1990-1999」「1990-」「-1999」「2010」→ 年份范围；认不出返回 null。 */
export function parseYears(
  text: string
): { yearFrom?: number; yearTo?: number } | null {
  const m = /^\s*(\d{4})?\s*(?:[-–~至到]\s*(\d{4})?)?\s*$/.exec(text)
  if (!m || (!m[1] && !m[2])) return null
  const single = !/[-–~至到]/.test(text)
  const from = m[1] ? Number(m[1]) : undefined
  const to = single ? from : m[2] ? Number(m[2]) : undefined
  if (from !== undefined && to !== undefined && from > to)
    return { yearFrom: to, yearTo: from }
  return {
    ...(from !== undefined ? { yearFrom: from } : {}),
    ...(to !== undefined ? { yearTo: to } : {}),
  }
}

/**
 * 用输入框的文字改一个胶囊。空文字等于删除；认不出的文字返回 null（保持原样、提示用户）。
 */
export function editChip(
  filter: NlFilter,
  chip: NlChip,
  text: string
): NlFilter | null {
  const t = text.trim()
  if (!t) return removeChip(filter, chip)
  switch (chip.field) {
    case 'genres':
    case 'people':
    case 'keywords':
      return replaceValue(filter, chip.field, chip.value, t)
    case 'countries': {
      const code = countryCode(t)
      return code ? replaceValue(filter, 'countries', chip.value, code) : null
    }
    case 'years': {
      const years = parseYears(t)
      if (!years) return null
      return { ...withoutYears(filter), ...years }
    }
    case 'ratingMin': {
      const value = Number(t)
      if (!Number.isFinite(value) || value <= 0 || value > 10) return null
      return { ...filter, ratingMin: Math.round(value * 10) / 10 }
    }
    default:
      return filter
  }
}
