import { canInstallMpv, installMpv } from '../mpv-install'
import { locateMpv } from '../mpv-locate'
import { mpvPlayer } from '../mpv-player'
import { emit, implement } from '../rpc'
import { onSettingChanged, settingsStore } from '../settings'
import { mpv } from '../../shared/contract/mpv'
import type { MpvStatus } from '../../shared/mpv'
import { withMpvTargets } from '../webdav'

const ok = { success: true }

/** 应用启动后多久开始预热 mpv */
const PREWARM_DELAY_MS = 3000
/** 这些设置变了，待命的 mpv 要重开或退出 */
const PREWARM_KEYS = new Set<string>([
  'player.mpvPrewarm',
  'player.engine',
  'player.mpvUi',
])

/** 等控制指令完成后统一返回成功（失败照常抛给渲染层） */
async function done(task: Promise<unknown>): Promise<{ success: boolean }> {
  await task
  return ok
}

/** 实现 mpv 域，并把播放器状态事件推到所有窗口。由 src/main/index.ts 调用一次。 */
export function registerMpvIpc(): void {
  implement(mpv, {
    open: async (_, options) => {
      try {
        // 远程（WebDAV）文件换成主进程本机代理地址，凭据不进 mpv 命令行
        await mpvPlayer.open(await withMpvTargets(options))
        return ok
      } catch (error) {
        // 常见于系统未安装 mpv：以失败结果返回，而不是抛异常，
        // 避免渲染层收到未处理的 IPC 报错（渲染层据此回退到内置播放器）。
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    probe: () => {
      const available = Boolean(locateMpv())
      return { available, installable: !available && canInstallMpv() }
    },
    install: async () => {
      if (locateMpv()) return ok
      emit(mpv, 'installing', true)
      try {
        await installMpv()
        return ok
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        emit(mpv, 'installing', false)
      }
    },
    pause: (_, paused) => done(mpvPlayer.pause(paused)),
    seek: (_, seconds, mode) => done(mpvPlayer.seek(seconds, mode)),
    volume: (_, vol) => done(mpvPlayer.setVolume(vol)),
    mute: (_, muted) => done(mpvPlayer.setMute(muted)),
    speed: (_, speed) => done(mpvPlayer.setSpeed(speed)),
    // RTX 视频超分开关（设置项）：影响 mpv 启动参数与运行时滤镜
    setVsr: (_, enabled) => done(mpvPlayer.setVsrEnabled(enabled)),
    // 高质量缩放：mpv 在运行时立即切换算法
    setHighQualityScaling: (_, enabled) =>
      done(mpvPlayer.imageEnhance.setHighQuality(enabled)),
    setEnhance: (_, level) => done(mpvPlayer.imageEnhance.setLevel(level)),
    setSubTrack: (_, id) => done(mpvPlayer.setSubTrack(id)),
    setAudioTrack: (_, id) => done(mpvPlayer.setAudioTrack(id)),
    addSubFile: (_, filePath) => done(mpvPlayer.addSubFile(filePath)),
    setCompact: (_, on) => done(mpvPlayer.setCompact(on)),
    showText: (_, text, ms) => done(mpvPlayer.showText(text, ms)),
    quit: () => {
      void mpvPlayer.stop()
      return ok
    },
  })

  // 后台常驻 mpv：启动后稍等一会儿（不和应用启动抢资源），设置变化时跟着调整
  setTimeout(() => {
    // 超分只能靠启动参数生效：先把开关读进来，再预热
    const vsr = settingsStore().get('player.rtxVsr')
    void mpvPlayer.setVsrEnabled(vsr).then(() => mpvPlayer.syncPrewarm())
  }, PREWARM_DELAY_MS).unref()
  onSettingChanged(change => {
    if (PREWARM_KEYS.has(change.key)) void mpvPlayer.syncPrewarm()
  })

  mpvPlayer.on('status', (status: MpvStatus) => emit(mpv, 'status', status))
  mpvPlayer.on('installing', (on: boolean) => emit(mpv, 'installing', on))
  mpvPlayer.on('error', (message: string) => emit(mpv, 'error', message))
}
