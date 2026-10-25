/**
 * 桌面 HLS 走主进程公网代理，保留原始清单地址以解析相对分片。
 * 例外：登记过的本机流（杜比视界重建会话的 127.0.0.1 服务，见 allowLocalStream）直连，
 * 公网代理按 SSRF 规则拒绝回环地址；只放行登记的前缀，远端清单里写的其他本机地址照样走代理被拒。
 */
import {
  FetchLoader,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
} from 'hls.js'
import {
  STREAM_RESPONSE_URL,
  streamUrl,
} from '../../../../../shared/stream-url'

/** 允许直连的本机流前缀（http://127.0.0.1:端口/令牌/） */
const localStreams = new Set<string>()

/** 登记一个本机流前缀；返回撤销函数。 */
export function allowLocalStream(prefix: string): () => void {
  if (!prefix) return () => {}
  localStreams.add(prefix)
  return () => {
    localStreams.delete(prefix)
  }
}

const isLocalStream = (url: string): boolean =>
  [...localStreams].some(prefix => url.startsWith(prefix))

export class DesktopHlsLoader extends FetchLoader {
  override load(
    context: LoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): void {
    if (!/^https?:\/\//i.test(context.url) || isLocalStream(context.url))
      return super.load(context, config, callbacks)
    super.load({ ...context, url: streamUrl(context.url) }, config, {
      ...callbacks,
      onSuccess: (response, stats, _context, details) =>
        callbacks.onSuccess(
          {
            ...response,
            url:
              details instanceof Response
                ? (details.headers.get(STREAM_RESPONSE_URL) ?? context.url)
                : context.url,
          },
          stats,
          context,
          details
        ),
      onError: (error, _context, details, stats) =>
        callbacks.onError(error, context, details, stats),
      onTimeout: (stats, _context, details) =>
        callbacks.onTimeout(stats, context, details),
      onProgress:
        callbacks.onProgress &&
        ((stats, _context, data, details) =>
          callbacks.onProgress!(stats, context, data, details)),
      onAbort:
        callbacks.onAbort &&
        ((stats, _context, details) =>
          callbacks.onAbort!(stats, context, details)),
    })
  }
}
