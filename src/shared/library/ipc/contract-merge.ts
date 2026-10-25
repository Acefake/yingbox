/**
 * 同一作品多份文件的合并展示：版本列表与手动拆分。
 *
 * 不同文件夹 / 不同盘里同一部电影或剧，扫描时各成一个本地条目（目录层不动）；
 * 识别到同一个元数据源 id（TMDB 电影 id / 剧 id，番号库是番号）后，展示层把它们当成一个条目：
 * 海报墙、搜索、筛选计数、追剧日历只出现一次，详情把各自的文件列成「版本」。
 * 误识别时可以把某个本地条目拆出来单独显示，拆分记在条目上，重新匹配到别的 id 后自动失效。
 */
import type { VideoRange } from '../../video-range'

/**
 * 一个可播放的版本：一个视频文件，或同一文件夹里的一组分段（CD1 / CD2）。
 * 详情里 versions 按「分辨率 > 动态范围 > 体积」从好到差排好，第一个就是默认播放的。
 */
export interface LibraryVersion {
  /** 稳定键（`f<首个文件 id>`），渲染层记住用户选了哪个版本。 */
  key: string
  /** 版本里的视频文件 id，按播放顺序。 */
  fileIds: number[]
  /** 垂直分辨率（2160 / 1080 / 720 …），从文件名或所在文件夹名读出；读不出为 null。 */
  height: number | null
  /** 动态范围：分段里最好的一档；探测结果优先，没探测过时看文件名；都没有为 null。 */
  range: VideoRange | null
  /** 总字节数。 */
  size: number
  /** 来源文件夹（系统路径，显示用）。 */
  folder: string
  /** 文件所属的本地条目（合并前的那个，拆分按它）。 */
  itemId: number
  libraryId: number
}

/** 合并进来的一个本地条目。 */
export interface MergeMember {
  itemId: number
  libraryId: number
  /** 这个条目所有视频文件的公共文件夹（系统路径）。 */
  folder: string
}

/**
 * 顶层条目的合并信息；只有真的合并了（members ≥ 2）或被手动拆出来时才有。
 */
export interface ItemMergeInfo {
  /** 合并展示的本地条目（含自身），按 id 升序。 */
  members: MergeMember[]
  /** 自己被手动拆出时，同一作品还有几个别的本地条目（> 0 时可以恢复合并）；没拆过为 0。 */
  splitFrom: number
}

/** 详情节点上与版本 / 合并有关的字段（LibraryItemNode 继承）。 */
export interface NodeMergeFields {
  /** 有视频文件的电影 / 集：可播放的版本，最好的在前。 */
  versions?: LibraryVersion[]
  /** 顶层条目：合并了别的文件夹里的同一作品，或被手动拆出。 */
  merge?: ItemMergeInfo
}

/** 合并相关方法。 */
export interface MergeRpcMap {
  /** 把一个本地条目从合并里拆出来，单独显示。 */
  'merge.split': { params: { itemId: number }; result: void }
  /** 撤销拆分，重新和同一作品的条目合并。 */
  'merge.join': { params: { itemId: number }; result: void }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const MERGE_METHODS = [
  'merge.split',
  'merge.join',
] as const satisfies readonly (keyof MergeRpcMap)[]

/** window.api.library 上的合并方法。 */
export interface LibraryMergeBridge {
  merge: {
    split(itemId: number): Promise<void>
    join(itemId: number): Promise<void>
  }
}
