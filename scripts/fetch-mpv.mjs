/** Prepare the locked Windows mpv runtime and its accompanying source bundle. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareMpvSources } from './mpv-sources.mjs'

if (process.platform === 'win32') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(root, 'scripts/prepare-mpv.ts'),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  await prepareMpvSources()
} else {
  console.log('[fetch:mpv] 非 Windows 平台使用系统安装的 mpv')
}
