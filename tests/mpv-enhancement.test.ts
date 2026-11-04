import { describe, expect, it, vi } from 'vitest'
import {
  MpvEnhancement,
  VSR_LABEL,
  vsrDecision,
} from '../src/main/mpv-enhancement'

const video = {
  w: 1280,
  h: 720,
  dw: 1280,
  dh: 720,
  gamma: 'bt.1886',
  primaries: 'bt.709',
}
const display = { w: 1920, h: 1080, ml: 0, mr: 0, mt: 0, mb: 0 }
const input = {
  enabled: true,
  platform: 'win32',
  video,
  display,
  hwdec: 'd3d11va',
  nvidia: true,
  track: { type: 'video' },
}

describe('mpv 超分策略', () => {
  it('只对需要放大的低分辨率 SDR 尝试配置', () => {
    expect(vsrDecision(input).state).toBe('ready')
    expect(vsrDecision({ ...input, display: { w: 640, h: 360 } }).state).toBe(
      'bypassed'
    )
    expect(vsrDecision({ ...input, video: { ...video, h: 1080 } }).state).toBe(
      'bypassed'
    )
    expect(
      vsrDecision({ ...input, video: { ...video, w: 1920, h: 800 } }).state
    ).toBe('bypassed')
  })
  it('HDR、HLG、广色域和未知色彩保持旁路', () => {
    expect(
      vsrDecision({
        ...input,
        track: { type: 'video', 'dolby-vision-profile': 8 },
      }).state
    ).toBe('bypassed')
    expect(vsrDecision({ ...input, track: null }).state).toBe('bypassed')
    expect(
      vsrDecision({ ...input, video: { ...video, colormatrix: 'dolbyvision' } })
        .state
    ).toBe('bypassed')
    for (const gamma of ['pq', 'hlg', 'unknown']) {
      expect(
        vsrDecision({ ...input, video: { ...video, gamma } }).state
      ).not.toBe('ready')
    }
    expect(
      vsrDecision({ ...input, video: { ...video, primaries: 'bt.2020' } }).state
    ).toBe('bypassed')
    expect(vsrDecision({ ...input, video: null }).state).toBe('waiting')
  })
  it('检查平台、GPU、实际硬解路径和无效数据', () => {
    expect(vsrDecision({ ...input, platform: 'darwin' }).state).toBe(
      'unsupported'
    )
    expect(vsrDecision({ ...input, nvidia: false }).state).toBe('unsupported')
    expect(vsrDecision({ ...input, hwdec: 'vaapi' }).state).toBe('unsupported')
    expect(vsrDecision({ ...input, video: { ...video, w: NaN } }).state).toBe(
      'waiting'
    )
    expect(vsrDecision({ ...input, enabled: false }).state).toBe('off')
  })
})

interface Harness {
  controller: MpvEnhancement
  sent: unknown[][]
  ready: () => Promise<void>
  holdAdd: () => () => void
  filters: () => Array<{ name: string; label: string }>
  fail: () => void
  failTrackProbe: (value: boolean) => void
}

function harness(): Harness {
  let filters: Array<{ name: string; label: string }> = [
    { name: 'scale', label: 'user-filter' },
  ]
  const sent: unknown[][] = []
  let fail = false
  let trackProbeFails = false
  let addGate: Promise<void> | null = null
  const controller = new MpvEnhancement(
    async (...command) => {
      sent.push(command)
      if (
        command[0] === 'get_property' &&
        command[1] === 'current-tracks/video' &&
        trackProbeFails
      )
        throw new Error('property unavailable')
      if (command[0] === 'get_property')
        return command[1] === 'current-tracks/video'
          ? { type: 'video' }
          : filters
      if (fail) throw new Error('unsupported')
      if (command[0] === 'vf' && command[1] === 'add') {
        if (addGate) await addGate
        filters.push({ name: 'd3d11vpp', label: VSR_LABEL })
      }
      if (command[0] === 'vf' && command[1] === 'remove')
        filters = filters.filter(f => f.label !== VSR_LABEL)
      return null
    },
    () => {},
    'win32',
    async () => true
  )
  const ready = async (): Promise<void> => {
    await controller.connect()
    await controller.startFile()
    controller.update('video-dec-params', video)
    controller.update('osd-dimensions', display)
    controller.update('hwdec-current', 'd3d11va')
    await controller.setEnabled(true)
  }
  const holdAdd = (): (() => void) => {
    let release: () => void = () => {}
    addGate = new Promise<void>(resolve => {
      release = resolve
    })
    return release
  }
  return {
    failTrackProbe: value => {
      trackProbeFails = value
    },
    controller,
    sent,
    ready,
    holdAdd,
    filters: () => filters,
    fail: () => {
      fail = true
    },
  }
}

describe('mpv 超分滤镜管理', () => {
  it('视频轨查询暂不可用时安全旁路，元数据恢复后可以重新评估', async () => {
    const h = harness()
    await h.ready()
    h.failTrackProbe(true)
    h.controller.update('video-dec-params', video)
    await h.controller.idle()
    expect(h.controller.status.state).toBe('bypassed')
    expect(h.filters().some(f => f.label === VSR_LABEL)).toBe(false)
    h.failTrackProbe(false)
    h.controller.update('video-dec-params', video)
    await h.controller.idle()
    expect(h.controller.status.state).toBe('configured')
  })
  it('未启用超分的普通播放不等待 GPU 枚举', async () => {
    const probe = vi.fn(async (): Promise<boolean | null> => null)
    const controller = new MpvEnhancement(
      async () => [],
      () => {},
      'win32',
      probe
    )
    await controller.connect()
    expect(probe).not.toHaveBeenCalled()
    await controller.setEnabled(true)
    expect(probe).toHaveBeenCalledTimes(1)
  })
  it('准备换片后旧视频属性和刷新不能重新挂载滤镜', async () => {
    const h = harness()
    await h.ready()
    await h.controller.prepareFile()
    const count = h.sent.filter(c => c[0] === 'vf' && c[1] === 'add').length
    h.controller.update('video-dec-params', video)
    h.controller.update('hwdec-current', 'd3d11va')
    await h.controller.refresh()
    await h.controller.idle()
    expect(h.sent.filter(c => c[0] === 'vf' && c[1] === 'add')).toHaveLength(
      count
    )
    expect(h.controller.source).toBeNull()
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
  })
  it('同步保护不可用时增强旁路，普通连接仍成功', async () => {
    const h = harness()
    await h.ready()
    await h.controller.setEnabled(false)
    await h.controller.connect(false)
    await h.controller.setEnabled(true)
    expect(h.controller.status.state).toBe('unsupported')
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
  })
  it('挂载进行中关闭开关，最终移除自身滤镜', async () => {
    const h = harness()
    const release = h.holdAdd()
    const ready = h.ready()
    await vi.waitFor(() =>
      expect(h.sent.some(c => c[0] === 'vf' && c[1] === 'add')).toBe(true)
    )
    const off = h.controller.setEnabled(false)
    release()
    await Promise.all([ready, off])
    expect(h.controller.status.state).toBe('off')
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
  })
  it('挂载迟到时换片，不能将旧状态写入新片源', async () => {
    const h = harness()
    const release = h.holdAdd()
    const ready = h.ready()
    await vi.waitFor(() =>
      expect(h.sent.some(c => c[0] === 'vf' && c[1] === 'add')).toBe(true)
    )
    const next = h.controller.startFile()
    release()
    await Promise.all([ready, next])
    expect(h.controller.status.state).toBe('waiting')
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
    expect(h.controller.source).toBeNull()
  })
  it('开关只管理自己的命名滤镜，不清除其他滤镜', async () => {
    const h = harness()
    await h.ready()
    expect(h.controller.status.state).toBe('configured')
    await h.controller.setEnabled(false)
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
    expect(h.sent.some(c => c[0] === 'vf' && c[1] === 'set')).toBe(false)
  })
  it('输出尺寸读取实际数据，不按输入乘二估算', async () => {
    const h = harness()
    await h.ready()
    expect(h.controller.output).toBeNull()
    h.controller.update('video-out-params', { w: 2000, h: 1125 })
    expect(h.controller.output).toEqual({ w: 2000, h: 1125 })
  })
  it('失败不反复尝试，开关仍能关闭且保留用户滤镜', async () => {
    const h = harness()
    h.fail()
    await h.ready()
    expect(h.controller.status.state).toBe('failed')
    const count = h.sent.length
    h.controller.update('osd-dimensions', display)
    await h.controller.idle()
    expect(h.sent).toHaveLength(count)
    await h.controller.setEnabled(false)
    expect(h.controller.status.state).toBe('off')
  })
  it('换片前清除影盒滤镜和上一片源状态', async () => {
    const h = harness()
    await h.ready()
    await h.controller.startFile()
    expect(h.filters()).toEqual([{ name: 'scale', label: 'user-filter' }])
    expect(h.controller.source).toBeNull()
    expect(h.controller.output).toBeNull()
    expect(h.controller.status.state).toBe('waiting')
  })
})
