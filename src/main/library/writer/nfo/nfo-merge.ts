/**
 * 决定最终写进磁盘的 NFO 文本：覆盖模式整份重写；合并模式保留用户手改过的字段。
 *
 * 判断“用户手改过”靠上次写入时记下的字段快照（writer_outputs.fields）：
 * 按顶层标签分组（同名标签如多个 genre 合成一组），逐组比较——
 * - 磁盘上的值等于上次写的值 → 没人动过，用这次生成的新值；
 * - 不等，或这个文件不是我们写的（没有快照）→ 保留磁盘上的值（空元素视为没写，用新值）；
 * - 上次写过、磁盘上没了 → 用户删掉的，不再补回；
 * - 磁盘上有、这次不生成的标签（其他工具的扩展字段）→ 原样保留，除非它就是我们上次写的旧值。
 * uniqueid 特殊处理：保留已有的各类 id，并补上缺少的类型（保证 tmdb id 总在）。
 *
 * 两种模式都尊重 `<lockdata>true</lockdata>`（Jellyfin / Emby 的“锁定元数据”）：直接不写。
 * 读不懂的旧文件（不是 XML、标签不配对）在合并模式下按新文件处理。
 */
import {
  type RawChild,
  type RawRoot,
  XML_DECLARATION,
  type XmlNode,
  attrOf,
  innerText,
  parseRoots,
  renderNode,
} from './xml'

/** 每个根元素一份：标签名 → 该组的规范化文本。 */
export type FieldSnapshot = Array<Record<string, string>>

/** composeNfo 的结果。 */
export type NfoOutcome =
  | { kind: 'write'; content: string; snapshot: FieldSnapshot }
  | { kind: 'locked' }

/** 按标签分组，保持首次出现的顺序。 */
function groups(children: RawChild[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const c of children) {
    const list = map.get(c.name)
    if (list) list.push(c.raw)
    else map.set(c.name, [c.raw])
  }
  return map
}

/** 规范化一组原文：去掉标签间空白、压缩空白，忽略缩进差异。 */
function normalize(raws: string[]): string {
  return raws
    .map(r => r.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim())
    .join('\n')
}

/** 空元素（自闭合或内容为空白）等价于“没写”。 */
function isEmptyElement(raw: string): boolean {
  if (!raw.includes('</')) return true
  return !raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('</')).trim()
}

/** 根元素的字段快照。 */
export function snapshotOf(roots: RawRoot[]): FieldSnapshot {
  return roots.map(root => {
    const shot: Record<string, string> = {}
    for (const [name, raws] of groups(root.children)) {
      if (name !== '#comment') shot[name] = normalize(raws)
    }
    return shot
  })
}

/** 是否带 lockdata=true。 */
function isLocked(roots: RawRoot[]): boolean {
  return roots.some(r =>
    r.children.some(
      c => c.name === 'lockdata' && innerText(c.raw).toLowerCase() === 'true'
    )
  )
}

/** uniqueid：保留已有，补上缺少的类型。 */
function mergeUniqueIds(existing: string[], ours: string[]): string[] {
  const types = new Set(existing.map(r => attrOf(r, 'type')?.toLowerCase()))
  return [
    ...existing,
    ...ours.filter(r => !types.has(attrOf(r, 'type')?.toLowerCase())),
  ]
}

/** 合并一个根元素的子节点。 */
function mergeRoot(
  ours: RawRoot,
  existing: RawRoot,
  last: Record<string, string> | undefined
): RawChild[] {
  const mine = groups(ours.children)
  const theirs = groups(existing.children)
  const out: RawChild[] = []
  const push = (name: string, raws: string[]): void => {
    for (const raw of raws) out.push({ name, raw })
  }
  for (const [name, raws] of mine) {
    const disk = theirs.get(name)
    const previous = last?.[name]
    if (!disk) {
      if (previous === undefined) push(name, raws)
      continue
    }
    if (
      disk.every(isEmptyElement) ||
      (previous !== undefined && normalize(disk) === previous)
    ) {
      push(name, raws)
    } else if (name === 'uniqueid') {
      push(name, mergeUniqueIds(disk, raws))
    } else {
      push(name, disk)
    }
  }
  for (const [name, raws] of theirs) {
    if (mine.has(name)) continue
    if (name !== '#comment' && last?.[name] === normalize(raws)) continue
    push(name, raws)
  }
  return out
}

/** 输出一个根元素（子节点两个空格缩进；原文内部的换行与缩进原样保留）。 */
function renderRaw(root: RawRoot, children: RawChild[]): string {
  if (!children.length) return root.openTag.replace(/>$/, ' />')
  const inner = children.map(c => `  ${c.raw}`).join('\n')
  return `${root.openTag}\n${inner}\n</${root.name}>`
}

/**
 * 生成最终 NFO 文本。
 * @param generated 这次生成的根元素
 * @param existing 磁盘上已有的文本；没有为 null
 * @param last 上次写入时的字段快照；不是我们写的为 null
 */
export function composeNfo(
  generated: XmlNode[],
  existing: string | null,
  mode: 'merge' | 'overwrite',
  last: FieldSnapshot | null
): NfoOutcome {
  const fresh = generated.map(r => renderNode(r)).join('\n')
  const freshContent = `${XML_DECLARATION}\n${fresh}\n`
  const ours = parseRoots(fresh)!
  const snapshot = snapshotOf(ours)
  const disk = existing === null ? null : parseRoots(existing)
  if (disk && isLocked(disk)) return { kind: 'locked' }
  if (mode === 'overwrite' || !disk) {
    return { kind: 'write', content: freshContent, snapshot }
  }
  const roots = ours.map((root, i) => {
    const old = disk[i]
    if (!old || old.name !== root.name) return renderRaw(root, root.children)
    return renderRaw(old, mergeRoot(root, old, last?.[i]))
  })
  return {
    kind: 'write',
    content: `${XML_DECLARATION}\n${roots.join('\n')}\n`,
    snapshot,
  }
}
