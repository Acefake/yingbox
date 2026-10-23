/** 桌面 HLS 走主进程公网代理，保留原始清单地址以解析相对分片。 */
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

export class DesktopHlsLoader extends FetchLoader {
  override load(
    context: LoaderContext,
    config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): void {
    if (!/^https?:\/\//i.test(context.url))
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
