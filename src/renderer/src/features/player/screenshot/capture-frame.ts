/**
 * 把 <video> 当前帧画到画布并编码成 PNG。
 * 跨域且没有 CORS 的视频会污染画布，toBlob 抛 SecurityError，由调用方提示或改走 ffmpeg。
 */

/**
 * 当前帧的 PNG 字节（原始分辨率）。
 * @param video 播放中的 <video>
 * @throws Error('not-ready') 还没有画面；SecurityError 画布被污染
 */
export async function grabFrame(video: HTMLVideoElement): Promise<Uint8Array> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('not-ready')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.drawImage(video, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    try {
      canvas.toBlob(resolve, 'image/png')
    } catch (error) {
      reject(error)
    }
  })
  if (!blob) throw new Error('PNG 编码失败')
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * 网页版没有主进程：直接让浏览器下载 PNG。
 * @param data PNG 字节
 * @param fileName 下载文件名
 */
export function downloadPng(data: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([data as BlobPart], { type: 'image/png' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
