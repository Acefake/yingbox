import type { MpvOpenOptions, MpvStatus } from '../mpv'
import {
  bool,
  call,
  defineDomain,
  event,
  int,
  num,
  oneOf,
  record,
  str,
} from './define'

type Ok = { success: boolean }

/** 外部 mpv 播放器。 */
export const mpv = defineDomain(
  'mpv',
  {
    /** 启动 mpv 播放；未安装时返回失败，渲染层据此回退内置播放器 */
    open: call<[options: MpvOpenOptions], { success: boolean; error?: string }>(
      a => [record<MpvOpenOptions>(a[0], 'options')]
    ),
    /** 暂停 / 继续 */
    pause: call<[paused: boolean], Ok>(a => [bool(a[0], 'paused')]),
    /** 跳转（默认绝对秒数） */
    seek: call<[seconds: number, mode?: 'absolute' | 'relative'], Ok>(a => [
      num(a[0], 'seconds'),
      a[1] == null
        ? undefined
        : oneOf(a[1], 'mode', ['absolute', 'relative'] as const),
    ]),
    /** 音量 0-100 */
    volume: call<[vol: number], Ok>(a => [num(a[0], 'vol')]),
    /** 静音 */
    mute: call<[muted: boolean], Ok>(a => [bool(a[0], 'muted')]),
    /** 倍速 */
    speed: call<[spd: number], Ok>(a => [num(a[0], 'spd')]),
    /** RTX 视频超分开关 */
    setVsr: call<[enabled: boolean], Ok>(a => [bool(a[0], 'enabled')]),
    /** 切换字幕轨；false 关闭字幕 */
    setSubTrack: call<[id: number | false], Ok>(a => [
      a[0] === false ? false : int(a[0], 'id'),
    ]),
    /** 切换音轨 */
    setAudioTrack: call<[id: number], Ok>(a => [int(a[0], 'id')]),
    /** 挂载外挂字幕文件 */
    addSubFile: call<[filePath: string], Ok>(a => [str(a[0], 'filePath')]),
    /** 缩小置顶：mpv 窗口缩到屏幕右下角并保持在最前（mpv 没有画中画）；on = false 还原 */
    setCompact: call<[on: boolean], Ok>(a => [bool(a[0], 'on')]),
    /** 退出 mpv */
    quit: call<Ok>(),
  },
  {
    /** 状态变化（时间、轨道、播放列表等） */
    status: event<MpvStatus>(),
    /** 启动或运行出错 */
    error: event<string>(),
  }
)
