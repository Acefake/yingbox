/**
 * 按画面搜点了某个视频画面：取条目详情，从那个文件的那个时间点开始播（电影的分段文件照常连播）。
 */
import { toast } from '@/components/ui'
import { libraryBridge } from '../api/bridge'
import { moviePlayRequest, play } from '../detail/playback'
import { momentRequest } from './visual-rules'

/** 播放某部片的某个文件、从 at 秒开始；条目或文件已不在时提示。 */
export async function playMoment(
  itemId: number,
  fileId: number,
  at: number
): Promise<void> {
  const node = await libraryBridge()?.getItem(itemId)
  const request = momentRequest(
    node ? moviePlayRequest(node) : null,
    fileId,
    at
  )
  if (!request) {
    toast.warning('这个视频已经不在媒体库里了')
    return
  }
  if (!(await play(request))) toast.warning('当前环境无法播放本地文件')
}
