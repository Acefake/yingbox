/**
 * 「添加来源」可选的来源类型：本地文件夹、115 网盘、WebDAV / Alist。
 * 哪些来源可用取决于运行环境（115 片库适配在服务端，WebDAV 凭据在桌面主进程），
 * 当前端用不了的来源不列出。纯规则，不碰 window。
 */
import type { IconName } from '@/components/ui/icons'

/** 来源类型。 */
export type SourceKind = 'local' | 'pan115' | 'webdav'

/** 来源分组名（来源选择界面的小标题）。 */
export type SourceGroupName = '本机' | '网盘' | '网络共享'

/** 一种来源在选择界面里的样子。 */
export interface SourceKindSpec {
  kind: SourceKind
  group: SourceGroupName
  title: string
  description: string
  icon: IconName
}

/** 运行环境：决定哪些来源能用。 */
export interface SourceEnv {
  /** 能读本地文件夹（桌面端，或网页端已连上片库服务） */
  local: boolean
  /** 115 片库：网页 / NAS 端走服务端，桌面端走主进程（需要网盘功能） */
  pan115: boolean
  /** 桌面端主进程提供 WebDAV 源 */
  webdav: boolean
}

/** 一个分组及其中的来源。 */
export interface SourceGroup {
  name: SourceGroupName
  items: SourceKindSpec[]
}

const SPECS: readonly SourceKindSpec[] = [
  {
    kind: 'local',
    group: '本机',
    title: '本地文件夹',
    description: '本机或 NAS 上存放影片的文件夹',
    icon: 'folder',
  },
  {
    kind: 'pan115',
    group: '网盘',
    title: '115 网盘',
    description:
      '使用「设置 · 网盘」里登录的账号，未登录先去登录；在线扫描并播放',
    icon: 'cloud',
  },
  {
    kind: 'webdav',
    group: '网络共享',
    title: 'WebDAV / Alist',
    description: '局域网 NAS 或 Alist 的 WebDAV 地址，Alist 还能再转接其他网盘',
    icon: 'database',
  },
]

/** 当前环境可用的来源，保持固定顺序。 */
export function availableSourceKinds(env: SourceEnv): SourceKindSpec[] {
  return SPECS.filter(spec => env[spec.kind])
}

/** 按分组归并，空分组不出现。 */
export function groupSourceKinds(
  specs: readonly SourceKindSpec[]
): SourceGroup[] {
  const groups: SourceGroup[] = []
  for (const spec of specs) {
    const group = groups.find(g => g.name === spec.group)
    if (group) group.items.push(spec)
    else groups.push({ name: spec.group, items: [spec] })
  }
  return groups
}
