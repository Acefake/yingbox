import { EventEmitter } from 'events'

/** mpv 播放与轨道控制命令，进程宿主负责实际发送。 */
export abstract class MpvControls extends EventEmitter {
  protected abstract cmd(...args: unknown[]): Promise<unknown>
  protected async setProp(name: string, value: unknown): Promise<void> {
    await this.cmd('set_property', name, value)
  }
  // ——— 播放控制 ———
  async pause(paused: boolean): Promise<void> {
    await this.setProp('pause', paused)
  }
  async seek(
    seconds: number,
    mode: 'absolute' | 'relative' = 'absolute'
  ): Promise<void> {
    await this.cmd('seek', seconds, mode)
  }
  async setVolume(vol: number): Promise<void> {
    await this.setProp('volume', Math.max(0, Math.min(200, vol)))
  }
  async setMute(muted: boolean): Promise<void> {
    await this.setProp('mute', muted)
  }
  async setSpeed(speed: number): Promise<void> {
    await this.setProp('speed', speed)
  }

  // ——— 轨道控制 ———
  async setSubTrack(id: number | false): Promise<void> {
    await this.setProp('sid', id === false ? 'no' : id)
  }
  async setAudioTrack(id: number): Promise<void> {
    await this.setProp('aid', id)
  }
  async addSubFile(filePath: string): Promise<void> {
    await this.cmd('sub-add', filePath, 'select')
  }
}
