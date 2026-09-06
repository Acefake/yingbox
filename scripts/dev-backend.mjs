import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../packages/services/backend'
)
const binName = process.platform === 'win32' ? 'main.exe' : 'main'
const binPath = path.join(backendDir, binName)

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: backendDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error('killed by ' + signal))
      else resolve(code ?? 0)
    })
  })
}

const buildCode = await run('go', ['build', '-o', binPath, '.'])
if (buildCode !== 0) process.exit(buildCode)

const child = spawn(binPath, [], {
  cwd: backendDir,
  stdio: 'inherit',
  windowsHide: true,
  shell: false,
})

const stop = () => {
  if (!child.killed) child.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

child.on('error', (err) => {
  console.error('[dev:backend]', err)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 0))
