/**
 * 追更 · 一集的转存目标（ADR-0029）：每次转存时现算，不只信存下来的 cid——整理会改名、挪走、删掉旧文件夹。
 *
 * 1. 片库里这部剧的家：有这一季的季文件夹就用季文件夹，本地路径换算成 115 cid；
 * 2. 这部剧手选的文件夹，先核对还在；
 * 3. 兜底目录（分类默认目录 / 剧集默认目录）下的「剧名 (年份)」子文件夹，没有就建。
 * 只有「明确没有」（没有家、换算不出、手选的已不在）才往下走；查询出错（网络、风控、片库没响应）直接抛出，
 * 这一集记转存失败、下一轮再试，不会因为一次抖动就另建文件夹散存。手选的文件夹不在了而兜底目录是 115 根目录时也报错，
 * 不建到媒体库外面去。
 */
import type { AutograbDeps } from './deps'
import type { Gate } from './gate'
import type { EpisodeRecord } from './state'

/** 解析要的能力（都经 115 闸门） */
export type TargetDeps = Pick<
  AutograbDeps,
  'seriesFolder' | 'seriesFolderName'
> & {
  pan: Pick<AutograbDeps['pan'], 'folderCid' | 'folderExists' | 'childFolder'>
}

/**
 * 这一集要存到的 115 文件夹 cid。
 * @param picked 这部剧手选的 cid（空串 = 没选）
 * @param fallback 兜底目录 cid（"0" = 115 根目录）
 */
export async function resolveEpisodeCid(
  deps: TargetDeps,
  record: Pick<EpisodeRecord, 'seriesId' | 'seriesTitle' | 'season'>,
  picked: string,
  fallback: string
): Promise<string> {
  const home = await deps.seriesFolder(record.seriesId)
  if (home) {
    const local = home.seasons[record.season] ?? home.dir
    const cid = await deps.pan.folderCid(local)
    if (cid && cid !== '0') return cid
  }
  const hasPick = picked !== '' && picked !== '0'
  if (hasPick && (await deps.pan.folderExists(picked))) return picked
  if (hasPick && fallback === '0')
    throw new Error(
      '给这部剧选的 115 文件夹已经不在了，请重新选一个，或在设置 · 网盘里设剧集默认目录'
    )
  const name = await deps.seriesFolderName(record.seriesId, record.seriesTitle)
  if (!name)
    throw new Error('算不出这部剧的文件夹名，请在追更里给它选一个 115 文件夹')
  return deps.pan.childFolder(fallback, name)
}

/**
 * 接到服务上的解析器：定位要列的目录、建的文件夹都走 115 闸门（一次调用算一个 snap）。
 * @param picked 剧 id → 手选的 cid（空串 = 没选）
 * @param fallback 剧 id → 兜底目录 cid（分类默认目录 / 剧集默认目录）
 */
export function episodeTarget(
  deps: TargetDeps,
  gate: () => Gate,
  picked: (seriesId: number) => string,
  fallback: (seriesId: number) => string
): (record: EpisodeRecord) => Promise<string> {
  const pan: TargetDeps['pan'] = {
    folderCid: dir => gate().run('snap', () => deps.pan.folderCid(dir)),
    folderExists: cid => gate().run('snap', () => deps.pan.folderExists(cid)),
    childFolder: (parent, name) =>
      gate().run('snap', () => deps.pan.childFolder(parent, name)),
  }
  return record =>
    resolveEpisodeCid(
      { ...deps, pan },
      record,
      picked(record.seriesId),
      fallback(record.seriesId)
    )
}
