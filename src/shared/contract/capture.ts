import { ContractError, call, defineDomain, num, str } from './define'

/** 截图 / GIF 的结果：成功时带保存路径 */
export interface CaptureResult {
  success: boolean
  path?: string
  error?: string
}

/** 截图字节（PNG）：只收 Uint8Array */
function bytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ContractError(`${name} 必须是 Uint8Array`)
  }
  return value
}

/** 截图与 GIF：文件写到「图片/影盒」，主进程负责落盘与调用 ffmpeg。 */
export const capture = defineDomain('capture', {
  /** 保存渲染层画好的 PNG；name 是文件名提示（可为空） */
  savePng: call<[data: Uint8Array, name: string, time: number], CaptureResult>(
    a => [bytes(a[0], 'data'), str(a[1] ?? '', 'name'), num(a[2], 'time')]
  ),
  /** 本地视频某一时刻的一帧（ffmpeg）；画布被跨域污染时的兜底。只接受 local:// */
  frame: call<[localUrl: string, time: number], CaptureResult>(a => [
    str(a[0], 'localUrl'),
    num(a[1], 'time'),
  ]),
  /** 能否生成 GIF（找到了 ffmpeg） */
  gifAvailable: call<boolean>(),
  /** 本地视频以 center 秒为中心、前后各 2.5 秒生成 GIF。只接受 local:// */
  gif: call<[localUrl: string, center: number], CaptureResult>(a => [
    str(a[0], 'localUrl'),
    num(a[1], 'center'),
  ]),
  /** 在文件夹中显示（只接受「图片/影盒」里的文件） */
  reveal: call<[filePath: string], { success: boolean; error?: string }>(a => [
    str(a[0], 'filePath'),
  ]),
})
