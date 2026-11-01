/**
 * 后台算指纹不能被卡住的网盘文件拖死：读不回来的文件到点按失败处理，队列才不会一直占着并发位置。
 */
import { describe, expect, it } from 'vitest'

import {
  fingerprintFile,
  withTimeout,
} from '../src/main/library/scanner/fingerprint'

describe('读文件的时限', () => {
  it('超时没结果就返回 undefined，有结果就原样返回', async () => {
    const never = new Promise<string>(() => {})
    expect(await withTimeout(never, 20)).toBeUndefined()
    expect(await withTimeout(Promise.resolve('ok'), 20)).toBe('ok')
  })

  it('不存在的文件返回 undefined，不抛错', async () => {
    expect(await fingerprintFile('Z:/不存在/文件.mkv', 500)).toBeUndefined()
  })
})
