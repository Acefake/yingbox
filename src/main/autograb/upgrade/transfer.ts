/**
 * 洗版与电影追踪共用的转存：和剧集追更 saver.ts 同样的保护——先列目标文件夹，同名已在就不再存；
 * 只传那一个 file_id；115 说「已经接收过」算成功。两次 115 请求都过闸门。
 * 洗版还会核对目标文件夹里确实有旧文件（防止把新文件存进认错的文件夹）。
 */
import type { GrabCandidate } from '../../../shared/contract/autograb-upgrade'
import type { Gate } from '../gate'

/** 115 说「已经接收过」 */
const ALREADY_RECEIVED = 4100024

/** 转存要的 115 能力 */
export interface TransferPan {
  names(cid: string): Promise<string[]>
  receive(
    url: string,
    password: string,
    fileIds: string[],
    cid: string
  ): Promise<void>
}

/**
 * 把候选那一个文件存进 cid。
 * @param mustContain 目标文件夹里必须已有的文件名（洗版传旧文件名）；没有时不转存、返回 'mismatch'
 * @returns 'saved' 新存的；'exists' 文件夹里已有同名文件或 115 说接收过；'mismatch' 文件夹不对
 * @throws 115 / 闸门错误原样抛出（调用方判断是否拉黑分享）
 */
export async function transferOne(
  gate: Gate,
  pan: TransferPan,
  candidate: GrabCandidate,
  cid: string,
  mustContain?: string
): Promise<'saved' | 'exists' | 'mismatch'> {
  const existing = await gate.run('snap', () => pan.names(cid))
  if (mustContain !== undefined && !existing.includes(mustContain))
    return 'mismatch'
  if (existing.includes(candidate.fileName)) return 'exists'
  try {
    await gate.run('receive', () =>
      pan.receive(
        candidate.shareUrl,
        candidate.password,
        [candidate.fileId],
        cid
      )
    )
    return 'saved'
  } catch (error) {
    if ((error as { code?: number }).code === ALREADY_RECEIVED) return 'exists'
    throw error
  }
}
