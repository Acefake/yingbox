import { app } from 'electron'

/** 仅枚举 NVIDIA 设备是否存在，不保证 mpv 使用该设备或驱动已开启 VSR。 */
export async function probeNvidiaGpu(): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), 2000)
    })
    const info = await Promise.race([app.getGPUInfo('basic'), timeout])
    if (
      info === null ||
      typeof info !== 'object' ||
      !('gpuDevice' in info) ||
      !Array.isArray(info.gpuDevice) ||
      info.gpuDevice.length === 0
    )
      return null
    const nvidia = info.gpuDevice.some(
      device =>
        device !== null &&
        typeof device === 'object' &&
        'vendorId' in device &&
        device.vendorId === 0x10de
    )
    if (nvidia) return true
    const allKnown = info.gpuDevice.every(
      device =>
        device !== null &&
        typeof device === 'object' &&
        'vendorId' in device &&
        typeof device.vendorId === 'number' &&
        Number.isFinite(device.vendorId) &&
        device.vendorId > 0
    )
    return allKnown ? false : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
