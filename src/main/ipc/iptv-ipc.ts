import { basename, join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'

import { createEpgStore } from '../iptv/epg-store'
import {
  downloadEpgBytes,
  fetchPlaylistText,
  readPlaylistText,
} from '../iptv/playlist-io'
import { implement } from '../rpc'
import { iptv } from '../../shared/contract/iptv'

/** 实现 iptv 域：播放列表读取与 XMLTV 节目单 */
export function registerIptvIpc(): void {
  const epg = createEpgStore({
    download: downloadEpgBytes,
    cacheDir: join(app.getPath('userData'), 'iptv', 'epg'),
  })

  implement(iptv, {
    fetchPlaylist: (_, url) => fetchPlaylistText(url.trim()),

    pickPlaylistFile: async ({ sender }) => {
      try {
        const owner = BrowserWindow.fromWebContents(sender)
        const options: Electron.OpenDialogOptions = {
          title: '选择直播源文件',
          properties: ['openFile'],
          filters: [{ name: '直播源', extensions: ['m3u', 'm3u8', 'txt'] }],
        }
        const result = owner
          ? await dialog.showOpenDialog(owner, options)
          : await dialog.showOpenDialog(options)
        const path = result.filePaths[0]
        if (result.canceled || !path) return { ok: false, canceled: true }
        const read = await readPlaylistText(path)
        return { ...read, path, name: basename(path) }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },

    readPlaylistFile: (_, path) => readPlaylistText(path),

    loadEpg: (_, url, force) => epg.load(url.trim(), force),

    epgProgrammes: async (_, url, queries, from, to) => {
      try {
        return {
          ok: true,
          data: await epg.programmes(url.trim(), queries, from, to),
        }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    },
  })
}
