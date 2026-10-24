import {
  type MediaCommand,
  type NowPlaying,
  parseNowPlaying,
} from '../now-playing'
import { ContractError, call, defineDomain, event } from './define'

/** 正在播放：内置播放器报状态给托盘 / 媒体键，托盘菜单与媒体键的操作推回播放器。 */
export const nowPlaying = defineDomain(
  'nowPlaying',
  {
    /** 报告当前播放状态；没在播（关闭播放器）时传 null */
    report: call<[state: NowPlaying | null], void>(a => {
      const state = parseNowPlaying(a[0])
      if (state === undefined)
        throw new ContractError('参数 state 不是合法的播放状态')
      return [state]
    }),
  },
  {
    /** 托盘菜单或媒体键发出的播放命令 */
    command: event<MediaCommand>(),
  }
)
