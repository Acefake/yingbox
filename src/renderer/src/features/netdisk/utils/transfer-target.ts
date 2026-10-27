/**
 * 网盘页转存目标的选择规则（纯函数）：用户没另选时按搜索命中的内容类型预选默认目录（剧集 → 剧集默认目录，
 * 电影或没对上 → 电影默认目录）；另选了某个默认目录或具体文件夹时用它。文件夹解析见 shared/netdisk/target-folder.ts。
 */
import {
  type TargetFolder,
  type TargetKind,
  type TargetSettings,
  defaultFolder,
  folderOf,
} from '../../../../../shared/netdisk/target-folder'
import type { IconName } from '@/components/ui/icons'

/** 胶囊面板里的一个默认目录 */
export interface FolderPreset {
  key: string
  label: string
  icon: IconName
  folder: TargetFolder
}

/** 胶囊里选中的结果：某个默认目录（key），或一个具体文件夹 */
export type FolderPick = { preset: string } | { folder: TargetFolder }

/** 用户的选择：null = 跟着内容类型走；kind = 指定某个默认目录；folder = 具体文件夹 */
export type TargetChoice =
  | { kind: TargetKind }
  | { folder: TargetFolder }
  | null

/** 生效的目标：文件夹 + 用的是哪个默认目录（null = 具体文件夹） */
export interface ResolvedChoice {
  folder: TargetFolder
  active: TargetKind | null
}

/** 默认目录在胶囊面板里的名字 */
export const KIND_LABELS: Record<TargetKind, string> = {
  movie: '电影',
  tv: '剧集',
}

/**
 * 选择 → 生效的文件夹。
 * @param choice 用户的选择
 * @param detected 搜索命中的内容类型；null = 没对上
 */
export function choiceFolder(
  choice: TargetChoice,
  detected: TargetKind | null,
  settings: TargetSettings
): ResolvedChoice {
  if (choice && 'folder' in choice)
    return {
      folder: folderOf(choice.folder.cid, choice.folder.name),
      active: null,
    }
  const kind = choice?.kind ?? detected ?? 'movie'
  return { folder: defaultFolder(kind, settings), active: kind }
}

/** 胶囊面板里的「默认目录」两项（电影 / 剧集） */
export function kindPresets(settings: TargetSettings): FolderPreset[] {
  return (['movie', 'tv'] as const).map(kind => ({
    key: kind,
    label: KIND_LABELS[kind],
    icon: kind,
    folder: defaultFolder(kind, settings),
  }))
}
