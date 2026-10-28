import { generateNotices } from './third-party-notices.mjs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** electron-builder runs this before collecting extraResources. */
export default function beforePack(context) {
  generateNotices()
  if (context.electronPlatformName === 'win32')
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./fetch-mpv.mjs', import.meta.url))],
      { stdio: 'inherit', windowsHide: true }
    )
}
