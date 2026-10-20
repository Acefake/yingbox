/**
 * 移动 / 改名识别：把同一次扫描里的“删除 + 新增”配对成移动，保留原文件记录（id、匹配、关联），
 * 不当成新文件重新识别。
 *
 * 判据（只看视频文件）：
 * 1. 大小相同，且新文件的 OpenSubtitles hash 等于旧记录的指纹 → 移动；
 * 2. 旧记录还没算指纹（指纹任务没跑完）时，大小相同且文件名相同（不分大小写）→ 移动
 *    （整理文件夹、目录改名的常见情况）。
 * 只有出现同大小候选时才去读新文件算 hash，绝大多数扫描不产生任何额外 IO。
 */
import type { ScannedFile, StoredFile } from './types'

/** 一次识别出的移动。 */
export interface FileMove {
  from: StoredFile
  to: ScannedFile
  /** 配对依据。 */
  by: 'fingerprint' | 'name'
  /** 为新文件算出的指纹（by 为 name 时也可能算过），写回数据库。 */
  fingerprint?: string
}

/** 计算新文件指纹；读不到时返回 undefined。 */
export type Fingerprinter = (file: ScannedFile) => Promise<string | undefined>

/** 在删除集合与新增集合之间找出移动，一一配对，每个旧记录最多配一次。 */
export async function detectMoves(
  removed: readonly StoredFile[],
  added: readonly ScannedFile[],
  fingerprint: Fingerprinter
): Promise<FileMove[]> {
  const bySize = new Map<number, StoredFile[]>()
  for (const file of removed) {
    if (file.kind !== 'video') continue
    const list = bySize.get(file.size)
    if (list) list.push(file)
    else bySize.set(file.size, [file])
  }
  if (bySize.size === 0) return []

  const moves: FileMove[] = []
  for (const file of added) {
    if (file.kind !== 'video') continue
    const candidates = bySize.get(file.size)
    if (!candidates?.length) continue

    let hash: string | undefined
    let index = -1
    if (candidates.some(c => c.fingerprint)) {
      hash = await fingerprint(file)
      if (hash) index = candidates.findIndex(c => c.fingerprint === hash)
    }
    let by: FileMove['by'] = 'fingerprint'
    if (index < 0) {
      const lower = file.name.toLowerCase()
      index = candidates.findIndex(
        c => !c.fingerprint && c.name.toLowerCase() === lower
      )
      by = 'name'
    }
    if (index < 0) continue
    const [from] = candidates.splice(index, 1)
    moves.push({ from, to: file, by, fingerprint: hash })
  }
  return moves
}
