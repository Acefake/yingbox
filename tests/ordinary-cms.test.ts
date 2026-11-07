import { describe, expect, it } from 'vitest'
import cmsSnapshot from '../src/shared/online/cms-snapshot.json'
import {
  isOrdinaryCmsSource,
  ordinaryCmsNameStem,
  partitionCmsAvSources,
} from '../src/shared/online/ordinary-cms'

const snapshotSites = (cmsSnapshot as { sites: { name: string; api: string }[] })
  .sites

const known = [
  { name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
  { name: '360资源', api: 'https://360zy.com/api.php/provide/vod' },
  { name: '牛牛点播', api: 'https://api.niuniuzy.me/api.php/provide/vod' },
  { name: '魔都资源', api: 'https://www.mdzyapi.com/api.php/provide/vod' },
  { name: '天涯影视', api: 'https://tyyszyapi.com/api.php/provide/vod' },
  { name: '爱奇艺', api: 'https://iqiyizyapi.com/api.php/provide/vod' },
  { name: '猫眼资源', api: 'https://api.maoyanapi.top/api.php/provide/vod' },
  { name: '非凡资源', api: 'https://api.ffzyapi.com/api.php/provide/vod' },
  { name: '飘零资源', api: 'https://p2100.net/api.php/provide/vod' },
  { name: '无尽资源', api: 'https://api.wujinapi.me/api.php/provide/vod/' },
]

describe('ordinaryCmsNameStem', () => {
  it('去掉空白与资源站 / 影院等后缀', () => {
    expect(ordinaryCmsNameStem('暴风资源站')).toBe('暴风')
    expect(ordinaryCmsNameStem('360 资源')).toBe('360')
    expect(ordinaryCmsNameStem('飘零影院资源站')).toBe('飘零')
    expect(ordinaryCmsNameStem('天涯影视资源站')).toBe('天涯')
    expect(ordinaryCmsNameStem('爱奇艺')).toBe('爱奇艺')
  })
})

describe('isOrdinaryCmsSource', () => {
  it('截图里的影视采集站按名称归普通源，不是 AV', () => {
    const remote = [
      '暴风资源站',
      '360资源站',
      '牛牛资源',
      '魔都资源站',
      '天涯影视资源站',
      '爱奇艺资源站',
      '猫眼资源',
      '非凡资源站',
      '飘零影院资源站',
    ]
    for (const name of remote) {
      expect(
        isOrdinaryCmsSource(
          { name, api: `https://example.test/${encodeURIComponent(name)}` },
          known
        )
      ).toBe(true)
    }
  })

  it('按 API（忽略末尾斜杠）也能认出普通源', () => {
    expect(
      isOrdinaryCmsSource(
        {
          name: '别名',
          api: 'https://api.wujinapi.me/api.php/provide/vod',
        },
        known
      )
    ).toBe(true)
  })

  it('真正的 AV 站名不误判成普通源', () => {
    for (const name of ['森林资源', '老鸭资源', '91麻豆', '黄瓜资源']) {
      expect(
        isOrdinaryCmsSource(
          { name, api: `https://av.example/${name}` },
          known
        )
      ).toBe(false)
    }
  })

  it('短主干与脏快照名不会前缀误伤 AV', () => {
    const dirty = [
      ...known,
      { name: 'IK', api: 'https://ikunzyapi.com/api.php/provide/vod/from/ikm3u8' },
      { name: '黄色资源啊啊', api: 'https://dirty.test/api.php/provide/vod' },
    ]
    expect(
      isOrdinaryCmsSource(
        { name: 'IK', api: 'https://av.example/ik' },
        dirty
      )
    ).toBe(false)
    expect(
      isOrdinaryCmsSource(
        { name: 'IKEA资源站', api: 'https://av.example/ikea' },
        dirty
      )
    ).toBe(false)
    expect(
      isOrdinaryCmsSource(
        { name: '黄色资源站', api: 'https://av.example/yellow' },
        dirty
      )
    ).toBe(false)
  })
})

describe('partitionCmsAvSources', () => {
  it('远程混合清单按已知普通源拆开', () => {
    const mixed = [
      { name: '暴风资源站', api: 'https://bf-remote.test/api.php/provide/vod' },
      { name: '森林资源', api: 'https://slapibf.com/api.php/provide/vod/' },
      { name: '非凡资源站', api: 'https://ff-remote.test/api.php/provide/vod' },
    ]
    expect(partitionCmsAvSources(mixed, known)).toEqual({
      ordinary: [mixed[0], mixed[2]],
      adult: [mixed[1]],
    })
  })

  it('对照真实 cms-snapshot：截图影视站进普通，内置 AV 站不进', () => {
    const { ordinary, adult } = partitionCmsAvSources(
      [
        { name: '暴风资源站', api: 'https://bf-remote.test/api.php/provide/vod' },
        { name: '森林资源', api: 'https://slapibf.com/api.php/provide/vod/' },
        { name: '黄色资源站', api: 'https://av.example/yellow' },
      ],
      snapshotSites
    )
    expect(ordinary.map(site => site.name)).toEqual(['暴风资源站'])
    expect(adult.map(site => site.name)).toEqual(['森林资源', '黄色资源站'])
  })
})
