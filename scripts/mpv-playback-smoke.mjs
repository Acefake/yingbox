import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// 在独立的 mpv 进程和命名管道内验证换片保护；不连接用户的播放会话。
const failRemove = process.argv.includes('--fail-remove')
const noAck = process.argv.includes('--no-ack')
const render = process.argv.includes('--render')
const source = await readFile('src/main/mpv-vsr-hook.ts', 'utf8')
let lua = source.match(/String\.raw`([\s\S]*?)`/)[1]
if (failRemove) {
  lua = lua.replace(
    'mp.add_hook',
    `
local original_commandv = mp.commandv
mp.commandv = function(...)
    local args = {...}
    if args[1] == 'vf' and args[2] == 'remove' then return nil, 'test failure' end
    return original_commandv(...)
end
mp.add_hook`
  )
}
const script = resolve(
  `out/vsr-hook-smoke-${failRemove ? 'failure' : 'success'}.lua`
)
await writeFile(script, lua)
const path = `\\\\.\\pipe\\yingbox-hook-smoke-${process.pid}`
const child = spawn(
  'resources/mpv/bin/mpv.exe',
  [
    '--no-config',
    render ? '--vo=gpu-next' : '--vo=null',
    ...(render
      ? ['--gpu-api=d3d11', '--window-minimized=yes', '--force-window=yes']
      : []),
    '--ao=null',
    '--idle=yes',
    '--keep-open=yes',
    `--script=${script}`,
    `--input-ipc-server=${path}`,
    'av://lavfi:testsrc2=size=320x180:rate=10:duration=10',
  ],
  { stdio: 'ignore', windowsHide: true }
)
let socket
let id = 0
let buffer = ''
const pending = new Map()
let gateSeen = false
try {
  for (let i = 0; i < 50; i++) {
    try {
      socket = await new Promise((resolve, reject) => {
        const s = connect(path)
        s.once('connect', () => resolve(s))
        s.once('error', error => {
          s.destroy()
          reject(error)
        })
      })
      break
    } catch {
      await delay(100)
    }
  }
  if (!socket) throw new Error('IPC connect failed')
  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line) continue
      const reply = JSON.parse(line)
      if (
        reply.event === 'client-message' &&
        reply.args?.[0] === 'yingbox-vsr-load'
      ) {
        gateSeen = true
        if (noAck) continue
        void (async () => {
          await delay(100)
          await send('vf', 'add', '@yingbox-vsr:format=fmt=yuv420p')
          await send(
            'script-message-to',
            reply.args[2],
            'yingbox-vsr-continue',
            reply.args[1]
          )
        })().catch(error => {
          console.error(error)
          process.exitCode = 1
        })
      }
      const done = pending.get(reply.request_id)
      if (done) {
        pending.delete(reply.request_id)
        done(reply)
      }
    }
  })
  const send = (...command) =>
    new Promise((resolve, reject) => {
      const request_id = ++id
      const timer = setTimeout(() => reject(new Error('IPC timeout')), 5000)
      pending.set(request_id, reply => {
        clearTimeout(timer)
        resolve(reply)
      })
      socket.write(JSON.stringify({ command, request_id }) + '\n')
    })
  await delay(200)
  const ready = await send('get_property', 'user-data/yingbox-vsr-hook')
  await send('vf', 'add', '@user-smoke:format=fmt=yuv420p')
  await send('vf', 'add', '@yingbox-vsr:format=fmt=yuv420p')
  await send('set_property', 'user-data/yingbox-vsr-controlled', true)
  await send(
    'loadfile',
    'av://lavfi:testsrc2=size=640x360:rate=10:duration=10',
    'replace'
  )
  let params, idle
  for (let i = 0; i < (noAck ? 120 : 30); i++) {
    params = await send('get_property', 'video-dec-params')
    idle = await send('get_property', 'idle-active')
    if (failRemove || noAck ? idle.data === true : params.data?.w === 640) break
    await delay(100)
  }
  const filters = await send('get_property', 'vf')
  await delay(100)
  const sourceSpecs = await send(
    'get_property',
    'user-data/yingbox-source-specs'
  )
  if (render && !failRemove && !noAck) {
    await send('set_property', 'pause', true)
    await delay(300)
    const screenshot = await send(
      'screenshot-to-file',
      resolve('out/mpv-source-specs.png'),
      'window'
    )
    if (screenshot.error !== 'success')
      throw new Error(`OSD 截图失败：${screenshot.error}`)
  }
  const labels = filters.data?.map(f => f.label) ?? []
  const safe =
    failRemove || noAck
      ? idle.data === true && params.data?.w !== 640
      : params.data?.w === 640 && !labels.includes('yingbox-vsr')
  const result = {
    failRemove,
    noAck,
    hookReady: ready.data,
    gateSeen,
    nextWidth: params.data?.w,
    idle: idle.data,
    labels,
    sourceSpecs: sourceSpecs.data,
    safe,
  }
  console.log(JSON.stringify(result))
  if (
    ready.data !== 'ready' ||
    !gateSeen ||
    !safe ||
    !labels.includes('user-smoke')
  )
    throw new Error('hook verification failed')
  if (
    !failRemove &&
    !noAck &&
    JSON.stringify(sourceSpecs.data) !== JSON.stringify(['360p'])
  )
    throw new Error('片源标识与解码输入尺寸不一致')
  await send('quit')
} finally {
  socket?.destroy()
  if (child.exitCode === null) child.kill()
}
