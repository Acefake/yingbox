/* 逐秒速率对比：直连 fetch vs 手动重定向 vs publicFetch，定位变慢发生在哪一层 */
import { publicFetch } from '../src/main/network'

const ASSET =
  'https://github.com/Acefake/yingbox/releases/download/v1.0.9/yingbox-setup-1.0.9.exe'
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function drain(label: string, open: () => Promise<Response>, seconds: number): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), seconds * 1000)
  const t0 = Date.now()
  let total = 0
  const perSecond: string[] = []
  let mark = t0
  let markBytes = 0
  try {
    const res = await open()
    console.log(`[${label}] status=${res.status} 首包=${Date.now() - t0}ms`)
    const reader = res.body!.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      const now = Date.now()
      if (now - mark >= 1000) {
        perSecond.push(`${((total - markBytes) / 1024).toFixed(0)}KB`)
        mark = now
        markBytes = total
      }
    }
  } catch (e) {
    console.log(`[${label}] 中断: ${(e as Error).name}: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  const secs = (Date.now() - t0) / 1000
  console.log(
    `[${label}] 共 ${(total / 1024 / 1024).toFixed(1)}MB / ${secs.toFixed(1)}s = ${(total / 1024 / 1024 / secs).toFixed(2)} MB/s`
  )
  console.log(`[${label}] 每秒: ${perSecond.join(' ')}`)
}

async function main(): Promise<void> {
  console.log('=== A 直连 fetch（UA=yingbox-desktop） ===')
  await drain(
    'A',
    () => fetch(ASSET, { headers: { 'User-Agent': 'yingbox-desktop' } }),
    12
  )

  console.log('\n=== B 直连 fetch（Chrome UA） ===')
  await drain(
    'B',
    () => fetch(ASSET, { headers: { 'User-Agent': CHROME_UA } }),
    12
  )

  console.log('\n=== C redirect:manual 自己跟一跳 ===')
  await drain(
    'C',
    async () => {
      const r1 = await fetch(ASSET, {
        headers: { 'User-Agent': 'yingbox-desktop' },
        redirect: 'manual',
      })
      const loc = r1.headers.get('location')!
      await r1.body?.cancel().catch(() => {})
      const r2 = await fetch(loc, { headers: { 'User-Agent': 'yingbox-desktop' } })
      return r2
    },
    12
  )

  console.log('\n=== D publicFetch（更新器实际走的路） ===')
  await drain(
    'D',
    () =>
      publicFetch(ASSET, {
        headers: { 'User-Agent': 'yingbox-desktop' },
      }),
    12
  )

  console.log('\n=== E publicFetch 不要外部 signal ===')
  await drain(
    'E',
    () => publicFetch(ASSET, { headers: { 'User-Agent': 'yingbox-desktop' } }),
    12
  )
}

void main()
