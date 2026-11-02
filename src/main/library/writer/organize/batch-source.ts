/** 整理批次的来源：番号库与普通片库不能混在一个批次里，没有任何步骤时记为 unknown。 */
export function batchSourceOf(
  sources: Array<'jav' | 'tmdb'>
): 'jav' | 'tmdb' | 'unknown' {
  const distinct = new Set(sources)
  if (distinct.size > 1) throw new Error('普通片库与番号库必须分别整理')
  return [...distinct][0] ?? 'unknown'
}
