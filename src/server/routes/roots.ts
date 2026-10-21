/**
 * 媒体根目录约束：网页端能浏览、能添加为媒体库的目录都必须在配置的根目录之内。
 *
 * 用 realpath 比较（跟随符号链接后再判断），挡住 ../ 与指向根目录之外的链接。
 * 桌面端没有这层：系统对话框本身就代表用户的选择；网页端任何拿到令牌的人都能调用，所以收窄到根目录。
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

/** 目标路径（不存在时抛 ENOENT）是否在某个根目录内；返回规范化后的真实路径，不在任何根目录内返回 null。 */
export async function resolveWithinRoots(
  path: string,
  roots: readonly string[]
): Promise<string | null> {
  if (!isAbsolute(path)) return null
  const target = await realpath(path)
  for (const root of roots) {
    const base = await realpath(root).catch(() => null)
    if (!base) continue
    const rel = relative(base, target)
    if (
      rel === '' ||
      (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
    )
      return target
  }
  return null
}
