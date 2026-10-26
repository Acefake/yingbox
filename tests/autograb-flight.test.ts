/**
 * 追更并发规则：一轮跑的途中被叫要补跑一轮（不并发两轮），同一集的转存连点 / 撞车只发一次。
 */
import { describe, expect, it } from 'vitest'

import {
  createRoundRunner,
  createSingleFlight,
} from '../src/main/autograb/flight'
import { episode, setup } from './autograb-harness'

/** 手动放行的一轮 */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => {}
  const wait = new Promise<void>(resolve => (open = resolve))
  return { wait, open }
}

describe('createRoundRunner', () => {
  it('不并发两轮；途中多次请求合成一次补跑，force 取并集', async () => {
    const rounds: boolean[] = []
    let active = 0
    let peak = 0
    const first = gate()
    const runner = createRoundRunner(async force => {
      rounds.push(force)
      active++
      peak = Math.max(peak, active)
      if (rounds.length === 1) await first.wait
      active--
    })
    const a = runner.run()
    const b = runner.run()
    const c = runner.run(true)
    expect(rounds).toEqual([false])
    first.open()
    await Promise.all([a, b, c])
    expect(rounds).toEqual([false, true])
    expect(peak).toBe(1)
  })

  it('一轮抛错不挂住后面的轮', async () => {
    let calls = 0
    const runner = createRoundRunner(async () => {
      calls++
      throw new Error('boom')
    })
    await runner.run()
    await runner.run()
    expect(calls).toBe(2)
  })
})

describe('createSingleFlight', () => {
  it('同一个键进行中共用一次，结束后可以再跑', async () => {
    const flight = createSingleFlight()
    let calls = 0
    const task = async (): Promise<number> => ++calls
    const [x, y] = await Promise.all([
      flight.run('k', task),
      flight.run('k', task),
    ])
    expect([x, y]).toEqual([1, 1])
    expect(await flight.run('k', task)).toBe(2)
    expect(await flight.run('other', task)).toBe(3)
  })
})

describe('追更服务 · 并发', () => {
  it('同一集连点两次转存：只向 115 发一次转存', async () => {
    const { service, received } = setup([episode(5)])
    await service.setSeries(7, { mode: 'confirm' })
    await service.tick()
    const [a, b] = await Promise.all([
      service.grab('7:1:5', 0),
      service.grab('7:1:5', 0),
    ])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(received).toEqual([['101']])
  })

  it('一轮跑的途中点重试：这一轮完了马上补跑，不用等下一个 30 分钟', async () => {
    const h = setup([episode(5), episode(6)])
    await h.service.setSeries(7, { mode: 'confirm' })
    await h.service.tick()
    await h.service.skip('7:1:5')
    await h.service.skip('7:1:6')
    // 重试第 6 集开出的那一轮卡在 PanSou 上，期间再点第 5 集的重试
    const hold = gate()
    const search = h.deps.pan.search
    h.deps.pan.search = async keyword => {
      await hold.wait
      return search(keyword)
    }
    await h.service.retry('7:1:6')
    await h.service.retry('7:1:5')
    hold.open()
    await h.service.tick()
    const status = async (key: string): Promise<string> =>
      (await h.service.overview()).episodes.find(e => e.key === key)!.status
    expect(await status('7:1:6')).toBe('found')
    expect(await status('7:1:5')).toBe('found')
  })
})
