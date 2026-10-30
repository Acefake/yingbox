/** 在独立 Docker daemon 中验证生产更新配置，不给更新器宿主 Docker socket。 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const daemon = `yingbox-update-smoke-${randomUUID()}`
const application =
  'ghcr.io/acefake/yingbox-nas@sha256:8a0928287f2cf830ad23581c89722ab2bf5f7df3424b32525bcb1eb557589591'
const dind =
  'docker:29-dind@sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977'
const image = 'localhost:5000/yingbox-update-test:stable'
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('YINGBOX_'))
)
environment.YINGBOX_MEDIA_DIR = '/tmp/yingbox-update-media'

async function execute(args, input) {
  const task = exec('docker', args, {
    env: environment,
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  if (input !== undefined) task.child.stdin.end(input)
  return task
}

async function docker(...args) {
  return (await execute(args)).stdout.trim()
}
async function nested(...args) {
  return docker('exec', daemon, 'docker', ...args)
}
async function inspect(name) {
  return JSON.parse(await nested('inspect', name))[0]
}

async function until(check, description, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return
    await setTimeout(1_000)
  }
  throw new Error(`等待超时：${description}`)
}

const compose = JSON.parse(
  await docker(
    'compose',
    '-f',
    'docker-compose.nas.yml',
    'config',
    '--format',
    'json'
  )
)
const app = compose.services.yingbox
const updater = compose.services.updater
assert.equal(app.image, 'ghcr.io/acefake/yingbox-nas:stable')
assert.equal(app.stop_grace_period, '1m0s')
assert.equal(updater.environment.WATCHTOWER_SCHEDULE, '0 0 4 * * *')
assert.equal(updater.environment.TZ, 'Asia/Shanghai')
assert.equal(updater.environment.WATCHTOWER_LABEL_ENABLE, 'true')
assert.equal(updater.environment.WATCHTOWER_SCOPE, 'yingbox-nas')
assert.equal(updater.environment.WATCHTOWER_INCLUDE_STOPPED, 'false')
assert.equal(updater.environment.WATCHTOWER_CLEANUP, 'false')
assert.deepEqual(updater.command, ['yingbox-nas'])
assert.equal(
  app.volumes.some(volume => volume.target === '/var/run/docker.sock'),
  false
)
assert.equal(
  updater.volumes.find(volume => volume.target === '/var/run/docker.sock')
    ?.source,
  '/var/run/docker.sock'
)
assert.match(updater.image, /:1\.23\.2@sha256:[a-f0-9]{64}$/)
assert.equal(updater.ports, undefined)

async function publishFixture(revision) {
  const versionedImage = image.replace(':stable', `:${revision}`)
  const result = await execute(
    [
      'exec',
      '-i',
      daemon,
      'docker',
      'build',
      '--network',
      'host',
      '-t',
      versionedImage,
      '-',
    ],
    `FROM ${application}\nLABEL yingbox.update-smoke=${revision}\n`
  )
  if (!result.stdout && !result.stderr) throw new Error('测试镜像构建没有输出')
  await nested('tag', versionedImage, image)
  await nested('push', image)
}

async function waitHealthy() {
  await until(
    async () =>
      (await inspect('yingbox-nas')).State.Health?.Status === 'healthy',
    '影盒健康检查'
  )
}

async function runUpdater() {
  const args = [
    'exec',
    daemon,
    'docker',
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
  ]
  for (const [key, value] of Object.entries(updater.environment))
    args.push('-e', `${key}=${value}`)
  args.push(
    '--label',
    'com.centurylinklabs.watchtower.enable=false',
    '--label',
    'com.centurylinklabs.watchtower.scope=yingbox-nas',
    updater.image,
    '--run-once',
    ...updater.command
  )
  const result = await execute(args)
  console.log(result.stdout + result.stderr)
}

async function appNode(source) {
  return nested('exec', 'yingbox-nas', 'node', '-e', source)
}
const rpc = (method, params) =>
  `fetch('http://127.0.0.1:31480/api/library/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({ method, params })})}).then(r=>r.json()).then(v=>{if(!v.ok)throw Error(JSON.stringify(v));console.log(JSON.stringify(v.result))})`

let created = false
try {
  await docker(
    'create',
    '--privileged',
    '--name',
    daemon,
    '-e',
    'DOCKER_TLS_CERTDIR=',
    dind
  )
  created = true
  await docker('start', daemon)
  await until(async () => {
    try {
      await nested('info', '--format', '{{.ServerVersion}}')
      return true
    } catch {
      return false
    }
  }, '隔离 Docker daemon')
  console.log(`隔离测试环境已启动：${daemon}`)
  await nested(
    'run',
    '-d',
    '--name',
    'registry',
    '-p',
    '5000:5000',
    'registry:3'
  )
  await nested('pull', application)
  await nested('pull', updater.image)
  await publishFixture('old')
  const labels = Object.entries(app.labels).flatMap(([key, value]) => [
    '--label',
    `${key}=${value}`,
  ])
  await nested(
    'run',
    '-d',
    '--name',
    'yingbox-nas',
    ...labels,
    '--stop-timeout',
    '60',
    '-e',
    'YINGBOX_HOST=0.0.0.0',
    '-e',
    'YINGBOX_AUTOGRAB=off',
    '-v',
    'config:/config',
    '-v',
    'cache:/cache',
    '-v',
    'media:/media',
    image
  )
  // 对照容器的标签也匹配，以验证名称筛选确实生效。
  await nested(
    'run',
    '-d',
    '--name',
    'unrelated-app',
    ...labels,
    '-e',
    'YINGBOX_HOST=0.0.0.0',
    image
  )
  await waitHealthy()
  await appNode(
    "const f=require('node:fs');f.writeFileSync('/config/update-sentinel','keep-me');f.mkdirSync('/media/smoke',{recursive:true})"
  )
  const library = JSON.parse(
    await appNode(rpc('addLibrary', { root: '/media/smoke', kind: 'movie' }))
  )
  const original = await inspect('yingbox-nas')
  const unrelated = await inspect('unrelated-app')
  console.log(`测试片库已创建：${library.id}`)

  await publishFixture('new')
  await runUpdater()
  await waitHealthy()
  const upgraded = await inspect('yingbox-nas')
  assert.notEqual(upgraded.Id, original.Id)
  assert.equal(upgraded.Config.Labels['yingbox.update-smoke'], 'new')
  assert.equal((await inspect('unrelated-app')).Id, unrelated.Id)
  assert.equal(
    await appNode(
      "console.log(require('node:fs').readFileSync('/config/update-sentinel','utf8'))"
    ),
    'keep-me'
  )
  const libraries = JSON.parse(await appNode(rpc('listLibraries')))
  assert.ok(
    libraries.some(
      item => item.id === library.id && item.root === '/media/smoke'
    )
  )
  assert.deepEqual(
    upgraded.Mounts.map(m => [m.Destination, m.Name]).sort(),
    original.Mounts.map(m => [m.Destination, m.Name]).sort()
  )
  console.log('PASS：自动替换、健康恢复、配置文件与真实片库保留、其他容器不变')

  await runUpdater()
  assert.equal((await inspect('yingbox-nas')).Id, upgraded.Id)
  console.log('PASS：无新版时不重建')

  await nested('stop', 'registry')
  await runUpdater()
  assert.equal((await inspect('yingbox-nas')).Id, upgraded.Id)
  assert.equal((await inspect('yingbox-nas')).State.Running, true)
  console.log('PASS：镜像仓库不可用时旧版继续运行')

  await nested('start', 'registry')
  await publishFixture('stopped-test')
  await nested('stop', 'yingbox-nas')
  await runUpdater()
  assert.equal((await inspect('yingbox-nas')).Id, upgraded.Id)
  assert.equal((await inspect('yingbox-nas')).State.Running, false)
  console.log('PASS：手动停止的影盒不会被启动')
} catch (error) {
  console.error(error.message, error.stderr ?? '')
  if (created) console.error(await docker('logs', '--tail', '60', daemon))
  process.exitCode = 1
} finally {
  if (created) await docker('rm', '-f', '-v', daemon)
}
