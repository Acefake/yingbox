/**
 * 为一个由引擎实现的域生成主进程 handlers：每个调用原样转发给引擎。
 * 与 host.ts 分开放：这里依赖主进程 IPC 注册器（main/rpc）的类型，host.ts 要保持不依赖 Electron。
 */
import type { CallContext, Handlers } from '../rpc'
import { type Domain, channelOf } from '../../shared/contract/define'
import type { EngineHost } from './host'

export function forwardTo<D extends Domain>(
  host: EngineHost,
  domain: D
): Handlers<D> {
  const handlers: Record<
    string,
    (ctx: CallContext, ...args: unknown[]) => unknown
  > = {}
  for (const key of Object.keys(domain.calls)) {
    const channel = channelOf(domain.name, key)
    handlers[key] = (_ctx, ...args) => host.invoke(channel, args)
  }
  return handlers as Handlers<D>
}
