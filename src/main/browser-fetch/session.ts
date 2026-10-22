import { session } from 'electron'
import { classifyPage } from '../../shared/net/cf-page'
import { CHROME_UA, PARTITION, isUsablePage } from './page'

/**
 * 会话直取：用代抓窗口同一个 partition 的 session.fetch（Chromium 网络栈、同 UA、带会话 cookie）
 * 直接取原始 HTML，不开窗口、不渲染。只在该主机刚由窗口过过挑战时使用。
 */

const SESSION_TIMEOUT_MS = 15000

/** 会话直取结果：正常页、可通过的挑战、硬封锁，或没取到可用页（出错 / 非 2xx / 空白）。 */
export type SessionPage =
  | { kind: 'ok'; html: string }
  | { kind: 'challenge' | 'blocked' | 'miss' }

/** 取一页；从不抛错，判定交给调用方决定退回窗口还是熔断。 */
export async function fetchViaSession(url: string): Promise<SessionPage> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS)
  try {
    const res = await session.fromPartition(PARTITION).fetch(url, {
      // 必须带上会话 cookie（cf_clearance）。Electron 37 不写也会带（e2e 实测），但 net.request 的
      // 文档默认是不带，显式写明不依赖这层默认值的翻译。
      credentials: 'include',
      headers: {
        'User-Agent': CHROME_UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    })
    const html = await res.text()
    const verdict = classifyPage(html)
    if (verdict !== 'ok') return { kind: verdict }
    return res.ok && isUsablePage(html)
      ? { kind: 'ok', html }
      : { kind: 'miss' }
  } catch {
    return { kind: 'miss' }
  } finally {
    clearTimeout(timer)
  }
}
