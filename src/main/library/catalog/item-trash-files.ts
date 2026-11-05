import { lstat, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileKindOf, pathKey } from '../scanner/rules'
import { sidecarOwner } from '../writer/organize/organize-targets'
import type { TrashFileTarget } from '../../../shared/library/ipc'

const SUBTITLE = /\.(?:srt|ass|ssa|vtt|sub|idx|sup)$/i
const FOLDER_METADATA =
  /^(?:(?:movie|tvshow|season)\.nfo|(?:folder|poster|fanart|banner|thumb|logo|clearlogo|clearart|landscape|discart|season\d+-(?:poster|thumb|banner)|season-specials-poster)\.(?:jpe?g|png|webp))$/i

const titleKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s*[（(](?:19|20)\d{2}[）)]\s*$/, '')
    .trim()

/** 从已确认的条目视频找旁挂和独占目录的元数据，目录本身从不作为回收目标。 */
export async function itemTrashFiles(
  root: string,
  videos: readonly TrashFileTarget[],
  writerPaths: ReadonlySet<string>,
  titles: readonly string[]
): Promise<TrashFileTarget[]> {
  const videoPaths = new Set(videos.map(video => pathKey(video.path)))
  const rootKey = pathKey(root)
  const titleKeys = new Set(titles.map(titleKey))
  const dirs = new Map<string, Set<string>>()
  for (const video of videos) {
    let dir = dirname(video.path)
    let child: string | undefined
    for (;;) {
      const key = pathKey(dir)
      if (key !== rootKey && !key.startsWith(`${rootKey}/`)) break
      let children = dirs.get(dir)
      if (!children) dirs.set(dir, (children = new Set()))
      if (child) children.add(pathKey(child))
      if (key === rootKey || dir === dirname(dir)) break
      child = dir
      dir = dirname(dir)
    }
  }

  const exclusive = new Map<string, boolean>()
  const sidecars: TrashFileTarget[] = []
  const deepestFirst = [...dirs].sort(([a], [b]) => b.length - a.length)
  for (const [dir, children] of deepestFirst) {
    const entries = await readdir(dir, { withFileTypes: true })
    const selectedByStem = new Map<string, boolean>()
    for (const { name } of entries) {
      if (fileKindOf(name.toLowerCase()) !== 'video') continue
      const stem = basename(pathKey(name), extname(pathKey(name)))
      const selected = videoPaths.has(pathKey(join(dir, name)))
      selectedByStem.set(stem, selected && selectedByStem.get(stem) !== false)
    }
    const owners = [...selectedByStem].map(([stem, selected]) => ({
      stem,
      selected,
    }))
    const owned =
      pathKey(dir) !== rootKey &&
      owners.every(owner => owner.selected) &&
      entries.every(entry => {
        if (entry.isSymbolicLink()) return false
        if (!entry.isDirectory()) return true
        if (entry.name === '.actors') return true
        const path = join(dir, entry.name)
        return children.has(pathKey(path)) && exclusive.get(pathKey(path))
      })
    exclusive.set(pathKey(dir), owned)
    const named =
      titleKeys.has(titleKey(basename(dir))) ||
      (/^(?:season\s*\d+|s\d+|第\s*\d+\s*季)$/i.test(basename(dir)) &&
        pathKey(dirname(dir)) !== rootKey &&
        titleKeys.has(titleKey(basename(dirname(dir)))))
    const add = async (path: string): Promise<void> => {
      const stat = await lstat(path)
      if (stat.isFile())
        sidecars.push({ path, size: stat.size, mtime: stat.mtimeMs })
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (owned && entry.isDirectory() && entry.name === '.actors') {
        for (const actor of await readdir(path, { withFileTypes: true })) {
          const photo = join(path, actor.name)
          if (actor.isFile() && writerPaths.has(pathKey(photo)))
            await add(photo)
        }
      }
      if (!entry.isFile()) continue
      const kind = fileKindOf(entry.name.toLowerCase())
      if (kind === 'video' || (!kind && !SUBTITLE.test(entry.name))) continue
      const owner = sidecarOwner(pathKey(entry.name), owners)
      if (
        owner
          ? !owner.selected
          : !owned ||
            (!(named && FOLDER_METADATA.test(entry.name)) &&
              !writerPaths.has(pathKey(path)))
      )
        continue
      await add(path)
    }
  }
  return [...sidecars, ...videos]
}
