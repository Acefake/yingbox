/**
 * 分辨「普通影视采集源」与 AV 源。
 * 远程 AV 清单（ziyuanzhan online.json）常把两者混在一起；按已知普通源的 API / 名称主干分流。
 */

export interface CmsSiteRef {
  name: string
  api: string
}

/** API 比较键：小写、去末尾斜杠。 */
export function cmsApiKey(api: string): string {
  return api.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * 普通影视源名称主干：去空白，再剥末尾「资源站 / 资源 / 站」与「影院 / 影视」。
 * 「暴风资源站」「暴风资源」→「暴风」；「飘零影院资源站」「飘零资源」→「飘零」。
 */
export function ordinaryCmsNameStem(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/(?:资源站|资源|站)$/u, '')
    .replace(/(?:影院|影视|点播)$/u, '')
    .toLowerCase()
}

/** 是否为已知的普通影视采集源（按 API，或规范化后的名称主干全等）。 */
export function isOrdinaryCmsSource(
  source: CmsSiteRef,
  knownOrdinary: readonly CmsSiteRef[]
): boolean {
  const api = cmsApiKey(source.api)
  if (api && knownOrdinary.some(site => cmsApiKey(site.api) === api)) return true
  const stem = ordinaryCmsNameStem(source.name)
  // 汉字两字起；纯拉丁短码（快照里的 IK / CK）不做名称匹配。
  const latin = /^[a-z0-9]+$/i.test(stem)
  if (stem.length < 2 || (latin && stem.length < 3)) return false
  return knownOrdinary.some(site => ordinaryCmsNameStem(site.name) === stem)
}

/** 把混合清单拆成普通影视源与其余（按 AV 处理）。 */
export function partitionCmsAvSources(
  sources: readonly CmsSiteRef[],
  knownOrdinary: readonly CmsSiteRef[]
): { ordinary: CmsSiteRef[]; adult: CmsSiteRef[] } {
  const ordinary: CmsSiteRef[] = []
  const adult: CmsSiteRef[] = []
  for (const source of sources) {
    ;(isOrdinaryCmsSource(source, knownOrdinary) ? ordinary : adult).push(
      source
    )
  }
  return { ordinary, adult }
}
