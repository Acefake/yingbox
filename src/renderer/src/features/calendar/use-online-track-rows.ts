/**
 * 日历里在线剧行的「追更」入口（ADR-0049）：给 CalendarRow 的参数，和点击后的处理。
 * 流程本身（建片库条目、候选、侧板）在 features/autograb 的 useOnlineTracking。
 */
import {
  type UseOnlineTrackingReturn,
  autograbAvailable,
  useOnlineTracking,
} from '@/features/autograb'

import { type CalendarEntry, onlineYear } from './calendar-rules'
import type { ShowDayGroup } from './calendar-rows'

export interface UseOnlineTrackRowsReturn {
  tracking: UseOnlineTrackingReturn
  /** 在线剧行的追更入口参数（片库里的行没有） */
  trackProps(group: ShowDayGroup): {
    trackable: boolean
    tracked: boolean
    busy: boolean
  }
  /** 点在线剧的「追更」 */
  trackOnline(entry: CalendarEntry): void
}

const showOf = (
  entry: CalendarEntry
): Parameters<UseOnlineTrackingReturn['track']>[0] => ({
  recordId: entry.online!.recordId,
  title: entry.title,
  year: onlineYear(entry.online!.detail),
})

export function useOnlineTrackRows(): UseOnlineTrackRowsReturn {
  const tracking = useOnlineTracking()
  return {
    tracking,
    trackProps: group => {
      const online = group.primary.online
      return {
        trackable: autograbAvailable && !!online,
        tracked: !!online && tracking.isTracked(showOf(group.primary)),
        busy: !!online && tracking.busy.value === online.recordId,
      }
    },
    trackOnline: entry => {
      if (entry.online) void tracking.track(showOf(entry))
    },
  }
}
