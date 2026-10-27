/**
 * 追更服务测试的假依赖：日历、115（分享快照 / 转存 / 列目录 / 空间 / 删除）、PanSou、状态读写、时钟都在内存里。
 */
import { vi } from 'vitest'

import type { AutograbDeps } from '../src/main/autograb/deps'
import {
  type AutograbService,
  createAutograbService,
} from '../src/main/autograb/service'
import { searchStart } from '../src/main/autograb/schedule-rules'
import type { DriveEntry } from '../src/main/pan115/client'
import type { CalendarEpisode } from '../src/shared/library/ipc'

export const GB = 1024 ** 3
export const AIR = '2026-10-20'

export function episode(
  n: number,
  fileId: number | null = null,
  filePath: string | null = null
): CalendarEpisode {
  return {
    seriesId: 7,
    libraryId: 1,
    seriesTitle: '繁花',
    season: 1,
    episode: n,
    title: null,
    airDate: AIR,
    still: null,
    backdrop: null,
    itemId: null,
    fileId,
    filePath,
  }
}

export interface Harness {
  service: AutograbService
  deps: AutograbDeps
  clock: { t: number }
  received: string[][]
  notified: string[]
  files: Map<string, DriveEntry[]>
  removed: string[]
  space: { remain: number }
}

export const FILE_05 = '繁花.第05集.2160p.WEB-DL.mkv'
/** 115 里一个文件夹的文件名 */
export const namesIn = (h: Harness, cid: string): string[] =>
  (h.files.get(cid) ?? []).map(e => e.name)

export function setup(
  episodes: CalendarEpisode[],
  initial: unknown = null
): Harness {
  const clock = { t: searchStart(AIR) + 60_000 }
  const files = new Map<string, DriveEntry[]>()
  const received: string[][] = []
  const notified: string[] = []
  const removed: string[] = []
  const space = { remain: 100 * GB }
  let saved: unknown = initial
  const deps: AutograbDeps = {
    calendar: async () => ({
      episodes,
      configured: true,
      series: 1,
      failed: 0,
    }),
    notify: async changes =>
      void notified.push(...changes.map(c => `${c.action} ${c.path}`)),
    pan: {
      loggedIn: () => true,
      pansouReady: () => true,
      search: vi.fn(async () => [
        {
          title: '繁花 2160p 中字',
          source: 'x',
          url: 'https://115.com/s/abc?password=1234',
          shareCode: 'abc',
          receiveCode: '1234',
        },
      ]),
      snap: async () => ({
        title: '繁花',
        count: 2,
        files: [
          {
            id: '101',
            name: '繁花.第05集.2160p.WEB-DL.mkv',
            size: 2 * GB,
            isDir: false,
          },
          {
            id: '102',
            name: '繁花.第06集.2160p.WEB-DL.mkv',
            size: 2 * GB,
            isDir: false,
          },
        ],
      }),
      receive: async (_url, _pwd, ids, cid) => {
        received.push(ids)
        files.set(cid, [
          ...ids.map(id => ({
            id: `9${id}`,
            name: id === '101' ? FILE_05 : id,
            size: 2 * GB,
            isDir: false,
          })),
          ...(files.get(cid) ?? []),
        ])
      },
      entries: async cid => files.get(cid) ?? [],
      space: async () => ({ total: 1000 * GB, remain: space.remain }),
      remove: async (cid, fileId) => {
        removed.push(fileId)
        files.set(
          cid,
          (files.get(cid) ?? []).filter(e => e.id !== fileId)
        )
      },
      dirPath: async () => ['剧集', '繁花'],
    },
    defaultFolder: () => ({ cid: '0', name: '' }),
    load: async () => saved,
    save: async state => void (saved = JSON.parse(JSON.stringify(state))),
    now: () => clock.t,
    sleep: async ms => void (clock.t += ms),
    emit: () => {},
    log: () => {},
  }
  return {
    service: createAutograbService(deps),
    deps,
    clock,
    received,
    notified,
    files,
    removed,
    space,
  }
}
