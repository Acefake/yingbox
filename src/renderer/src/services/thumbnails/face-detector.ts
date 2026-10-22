/**
 * Shape Detection API 的 FaceDetector（Chromium 内置，零依赖）：海报取景的人脸细化。
 *
 * 主进程用 --enable-blink-features=FaceDetector 打开它（src/main/index.ts）。可用性实测：
 * - Windows（Windows.Media.FaceAnalysis）、macOS（Vision）有系统实现；
 * - Linux 没有实现：构造得出来，detect 报 NotSupportedError（focus.ts 收到后不再尝试）；
 * - 网页端浏览器默认没开这项，没有 FaceDetector 时整段跳过，只用主进程的启发式焦点。
 * 桌面主窗口 webSecurity: false，yingbox-media:// 的图不算跨域污染，可以直接交给 detect。
 */

/** 人脸框（像素，相对图片天然尺寸）。 */
export interface FaceBox {
  x: number
  y: number
  width: number
  height: number
}

/** 检测一张已加载的图里的人脸。 */
export type FaceDetect = (img: HTMLImageElement) => Promise<FaceBox[]>

/** lib.dom 还没有 FaceDetector 的类型，只声明用到的部分。 */
interface FaceDetectorLike {
  detect(source: HTMLImageElement): Promise<Array<{ boundingBox: FaceBox }>>
}
type FaceDetectorCtor = new (options: {
  fastMode: boolean
  maxDetectedFaces: number
}) => FaceDetectorLike

/** 当前环境的人脸检测；没有 FaceDetector 返回 null。 */
export function faceDetector(): FaceDetect | null {
  const Ctor = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector
  if (!Ctor) return null
  let detector: FaceDetectorLike | null = null
  return async img => {
    detector ??= new Ctor({ fastMode: true, maxDetectedFaces: 8 })
    const faces = await detector.detect(img)
    return faces.map(({ boundingBox: b }) => ({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }))
  }
}
