/**
 * 分面筛选的纯规则：分面与类型的中文名、点选切换、已选条件列表、计数。
 *
 * 筛选条件是不可变的 FacetFilter：每次点选返回新对象，空数组直接去掉，
 * 这样「什么都没选」就是 {}，查询里不带 facets。
 */
import type {
  FacetField,
  FacetFilter,
  JavKind,
} from '../../../../../shared/library/ipc'

/** 面板里可切换的文本分面（类型单独一行，不在这里）。 */
export type TextFacet = Exclude<FacetField, 'kind'>

/** 文本分面页签（顺序即界面顺序）。 */
export const FACET_TABS: ReadonlyArray<{ value: TextFacet; label: string }> = [
  { value: 'tag', label: '标签' },
  { value: 'actor', label: '演员' },
  { value: 'studio', label: '制作商' },
  { value: 'series', label: '系列' },
  { value: 'director', label: '导演' },
]

/** 番号类型的中文名（顺序即界面顺序）。 */
export const KIND_LABELS: ReadonlyArray<{ value: JavKind; label: string }> = [
  { value: 'censored', label: '有码' },
  { value: 'uncensored', label: '无码' },
  { value: 'fc2', label: 'FC2' },
  { value: 'amateur', label: '素人' },
]

const FIELD_LABEL: Record<FacetField, string> = {
  kind: '类型',
  ...(Object.fromEntries(FACET_TABS.map(t => [t.value, t.label])) as Record<
    TextFacet,
    string
  >),
}

/** 分面中文名。 */
export const facetLabel = (field: FacetField): string => FIELD_LABEL[field]

/** 取值的显示名：类型翻成中文，其余原样。 */
export function valueLabel(field: FacetField, value: string): string {
  if (field !== 'kind') return value
  return KIND_LABELS.find(k => k.value === value)?.label ?? value
}

/** 某个取值是否已选。 */
export function isSelected(
  filter: FacetFilter,
  field: FacetField,
  value: string
): boolean {
  return (filter[field] as string[] | undefined)?.includes(value) ?? false
}

/** 点选：没选的加上、已选的去掉；返回新对象，空分面去掉。 */
export function toggleValue(
  filter: FacetFilter,
  field: FacetField,
  value: string
): FacetFilter {
  const current = (filter[field] as string[] | undefined) ?? []
  const next = current.includes(value)
    ? current.filter(v => v !== value)
    : [...current, value]
  const out: FacetFilter = { ...filter }
  if (next.length) (out as Record<FacetField, string[]>)[field] = next
  else delete out[field]
  return out
}

/** 已选的一个条件（面板外的已选条上逐个显示）。 */
export interface ActiveFacet {
  field: FacetField
  value: string
  label: string
}

const ORDER: readonly FacetField[] = ['kind', ...FACET_TABS.map(t => t.value)]

/** 已选条件，按分面顺序、再按选择顺序。 */
export function activeFacets(filter: FacetFilter): ActiveFacet[] {
  return ORDER.flatMap(field =>
    ((filter[field] as string[] | undefined) ?? []).map(value => ({
      field,
      value,
      label: valueLabel(field, value),
    }))
  )
}

/** 已选条件个数（筛选按钮上的数字）。 */
export const activeCount = (filter: FacetFilter): number =>
  activeFacets(filter).length

/** 面板底部的规则说明。 */
export const FACET_HINT = '标签需同时满足，其余分面任选其一'
