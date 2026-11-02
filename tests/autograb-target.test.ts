/**
 * 追更转存目标（ADR-0029）：片库里这部剧的家 > 手选且还在的文件夹 > 兜底目录下的「剧名」子文件夹；解析不出不平铺。
 */
import { describe, expect, it } from 'vitest'

import { FILE_05, child, episode, namesIn, setup } from './autograb-harness'

/** 这部剧手选了文件夹 55、全自动、确认数已满 */
const picked = {
  version: 1,
  series: {
    '7': {
      title: '繁花',
      mode: 'auto',
      cid: '55',
      cidName: '繁花',
      confirmed: 3,
    },
  },
}

const HOME = '/mnt/115/剧集/大陆/繁花 (2023)'

describe('追更 · 转存目标', () => {
  it('片库里已有这部剧：存进它的季文件夹，不用手选的旧文件夹', async () => {
    const h = setup([episode(5)], picked)
    h.homes.set(7, { dir: HOME, seasons: { 1: `${HOME}/Season 01` } })
    h.localCids.set(`${HOME}/Season 01`, '88')
    await h.service.tick()
    expect(namesIn(h, '88')).toEqual([FILE_05])
    expect(namesIn(h, '55')).toEqual([])
    const record = (await h.service.overview()).episodes[0]
    expect(record.status).toBe('saved')
  })

  it('这一季还没有季文件夹：存进剧文件夹', async () => {
    const h = setup([episode(5)], picked)
    h.homes.set(7, { dir: HOME, seasons: { 2: `${HOME}/Season 02` } })
    h.localCids.set(HOME, '80')
    await h.service.tick()
    expect(namesIn(h, '80')).toEqual([FILE_05])
  })

  it('片库路径换算不出 115 文件夹：退回手选的文件夹', async () => {
    const h = setup([episode(5)], picked)
    h.homes.set(7, { dir: HOME, seasons: {} })
    await h.service.tick()
    expect(namesIn(h, '55')).toEqual([FILE_05])
  })

  it('手选的文件夹已被删（整理挪走后清空）：存到剧集默认目录下这部剧的子文件夹', async () => {
    const h = setup([episode(5)], picked)
    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    h.gone.add('55')
    await h.service.tick()
    expect(namesIn(h, child('66'))).toEqual([FILE_05])
    expect(namesIn(h, '66')).toEqual([])
  })

  it('算不出剧文件夹名：转存失败并说明原因，不平铺进默认目录', async () => {
    const h = setup([episode(5)])
    h.deps.seriesFolderName = async () => null
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    const result = await h.service.grab('7:1:5', 0)
    expect(result.ok).toBe(false)
    expect(h.received).toEqual([])
    const record = (await h.service.overview()).episodes[0]
    expect(record.status).toBe('found')
    expect(record.error).toContain('文件夹名')
  })

  it('查片库或 115 出错：这一集转存失败、下一轮再试，不另建文件夹散存', async () => {
    const h = setup([episode(5)], picked)
    h.deps.defaultFolder = () => ({ cid: '66', name: '剧集' })
    h.deps.seriesFolder = async () => {
      throw new Error('片库没响应')
    }
    await h.service.tick()
    expect(h.received).toEqual([])
    const record = (await h.service.overview()).episodes[0]
    expect(record.status).toBe('found')
    expect(record.error).toContain('片库没响应')

    h.deps.seriesFolder = async () => null
    h.deps.pan.folderExists = async () => {
      throw new Error('网络超时')
    }
    expect((await h.service.grab('7:1:5', 0)).ok).toBe(false)
    expect(namesIn(h, child('66'))).toEqual([])
  })

  it('手选的文件夹不在了、又没有默认目录：报错让用户重选，不建到 115 根目录', async () => {
    const h = setup([episode(5)], picked)
    h.gone.add('55')
    await h.service.tick()
    expect(h.received).toEqual([])
    const record = (await h.service.overview()).episodes[0]
    expect(record.error).toContain('重新选一个')
    expect(namesIn(h, child('0'))).toEqual([])
  })
})
