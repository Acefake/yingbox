/**
 * 实现 danmaku 域：凭据来自设置（danmaku.appId + 密钥 danmaku.appSecret），
 * 弹幕缓存放在 userData/danmaku/comments。match 只接受 local:// URL。
 */
import { app } from 'electron'
import { join } from 'node:path'

import { danmaku } from '../../shared/contract/danmaku'
import { createCommentCache } from '../danmaku/comment-cache'
import { createDanmakuService } from '../danmaku/service'
import { localUrlToFilePath } from '../local-media'
import { implement } from '../rpc'
import { settingsStore } from '../settings'

/** 注册弹幕 IPC（initSettings 之后调用） */
export function registerDanmakuIpc(): void {
  const service = createDanmakuService({
    credentials: () => ({
      appId: settingsStore().get('danmaku.appId'),
      appSecret: settingsStore().getSecret('danmaku.appSecret'),
    }),
    cache: createCommentCache(
      join(app.getPath('userData'), 'danmaku', 'comments')
    ),
  })
  implement(danmaku, {
    match: async (_, localUrl) => {
      const filePath = localUrlToFilePath(localUrl)
      if (!filePath) return { success: false, error: 'invalid local url' }
      return service.match(filePath)
    },
    search: (_, anime, episode) => service.search(anime, episode),
    comments: (_, episodeId) => service.comments(episodeId),
  })
}
