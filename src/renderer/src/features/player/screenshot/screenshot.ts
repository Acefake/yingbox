/**
 * 截图 / GIF：控制栏的截图按钮，右键「截图」「截 GIF」。
 *
 * 截图：画布取当前帧 → 主进程存到「图片/影盒」；画布被跨域污染时本地文件改用 ffmpeg 截帧，在线流提示失败。
 * GIF：只支持本地文件，主进程用 ffmpeg 取当前时刻前后各 2.5 秒；找不到 ffmpeg 时菜单项置灰并说明原因。
 * 保存后播放器左下角出现「在文件夹中显示」，全屏时也可用。网页版没有主进程，截图直接下载。
 */
import type Artplayer from 'artplayer'

import { artIcon } from '../utils/art-options'
import { downloadPng, grabFrame } from './capture-frame'
import {
  frameFailure,
  frameFailureText,
  gifSupport,
  isLocalUrl,
  nameHint,
} from './screenshot-rules'
import './screenshot.css'

/** 保存提示停留多久（毫秒） */
const SAVED_MS = 6000

/** 主进程返回的保存结果 */
interface SaveResult {
  success: boolean
  path?: string
  error?: string
}

/**
 * 给一个播放器实例装上截图与 GIF。实例销毁时自动拆除。
 * @param art Artplayer 实例
 * @param withControls 是否在控制栏放截图按钮
 */
export function installScreenshot(art: Artplayer, withControls: boolean): void {
  const api = typeof window !== 'undefined' ? window.api?.capture : undefined
  let busy = false
  let ffmpeg: boolean | null = null
  let savedTimer: number | undefined
  let savedPath = ''

  const saved = art.layers.add({
    name: 'ybCaptureSaved',
    html: `<span class="yb-capture__text"></span><span class="yb-capture__reveal" role="button" tabindex="0">在文件夹中显示</span>`,
  })
  saved?.classList.add('yb-capture')
  const savedText = saved?.querySelector<HTMLElement>('.yb-capture__text')
  const reveal = saved?.querySelector<HTMLElement>('.yb-capture__reveal')

  const showSaved = (text: string, path: string): void => {
    if (!saved || !savedText) return
    savedPath = path
    savedText.textContent = text
    saved.classList.add('is-open')
    window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(
      () => saved.classList.remove('is-open'),
      SAVED_MS
    )
  }
  const openFolder = (): void => {
    if (!api || !savedPath) return
    void api.reveal(savedPath).then(result => {
      if (!result.success) art.notice.show = result.error || '无法打开文件夹'
    })
  }
  reveal?.addEventListener('click', openFolder)
  reveal?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') openFolder()
  })
  saved?.addEventListener('click', event => event.stopPropagation())

  /** 保存结果的提示：成功显示「在文件夹中显示」，失败给出原因 */
  const report = (result: SaveResult, done: string, failed: string): void => {
    if (result.success && result.path) showSaved(done, result.path)
    else art.notice.show = `${failed}：${result.error || '未知错误'}`
  }

  /** 截当前帧 */
  const shoot = async (): Promise<void> => {
    if (busy) return
    busy = true
    const time = art.video.currentTime
    const url = art.url
    try {
      let data: Uint8Array | null = null
      let failure = frameFailure(null)
      try {
        data = await grabFrame(art.video)
      } catch (error) {
        failure = frameFailure(error)
      }
      if (!api) {
        if (data) downloadPng(data, `${nameHint(url) || '影盒截图'}.png`)
        else art.notice.show = frameFailureText(failure)
        return
      }
      if (data) {
        report(
          await api.savePng(data, nameHint(url), time),
          '已保存截图',
          '截图失败'
        )
      } else if (failure !== 'not-ready' && isLocalUrl(url)) {
        // 画布被污染：本地文件改用 ffmpeg 按时刻截帧
        report(await api.frame(url, time), '已保存截图', '截图失败')
      } else {
        art.notice.show = frameFailureText(failure)
      }
    } catch (error) {
      art.notice.show = `截图失败：${(error as Error).message}`
    } finally {
      busy = false
    }
  }

  /** 截 GIF（当前时刻前后各 2.5 秒） */
  const shootGif = async (): Promise<void> => {
    const support = gifSupport({
      desktop: Boolean(api),
      local: isLocalUrl(art.url),
      ffmpeg,
    })
    if (!support.enabled || !api) {
      art.notice.show = support.reason
      return
    }
    if (busy) return
    busy = true
    art.notice.show = '正在生成 GIF…'
    try {
      report(
        await api.gif(art.url, art.video.currentTime),
        '已保存 GIF',
        'GIF 生成失败'
      )
    } catch (error) {
      art.notice.show = `GIF 生成失败：${(error as Error).message}`
    } finally {
      busy = false
    }
  }

  if (withControls) {
    art.controls.add({
      name: 'ybScreenshot',
      position: 'right',
      index: 24,
      tooltip: '截图',
      html: artIcon('image'),
      click: () => void shoot(),
    })
  }
  art.contextmenu.add({
    name: 'ybScreenshot',
    html: '截图',
    click() {
      art.contextmenu.show = false
      void shoot()
    },
  })
  const gifItem = art.contextmenu.add({
    name: 'ybScreenshotGif',
    html: '截 GIF（前后 2.5 秒）',
    click() {
      art.contextmenu.show = false
      void shootGif()
    },
  })

  /** 按当前能否截 GIF 置灰菜单项，悬停显示原因 */
  const renderGifItem = (): void => {
    if (!gifItem) return
    const support = gifSupport({
      desktop: Boolean(api),
      local: isLocalUrl(art.url),
      ffmpeg,
    })
    gifItem.classList.toggle('is-disabled', !support.enabled)
    gifItem.title = support.reason
  }
  renderGifItem()
  if (api && isLocalUrl(art.url)) {
    void api
      .gifAvailable()
      .then(found => {
        ffmpeg = found
      })
      .catch(() => {
        ffmpeg = false
      })
      .finally(renderGifItem)
  }

  art.on('destroy', () => window.clearTimeout(savedTimer))
}
