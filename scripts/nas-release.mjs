/** 验证已发布的双架构 NAS 镜像后，将 stable 指向同一不可变索引。本机与 CI 共用。 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repository = 'ghcr.io/acefake/yingbox-nas'
/** PID 1 必须是降权后的非 root 身份（入口脚本用 setpriv 换过）。 */
const NON_ROOT_CHECK =
  'const s=require("node:fs").readFileSync("/proc/1/status","utf8");const uid=s.match(/^Uid:\\s+(\\d+)/m)?.[1];if(!uid||uid==="0")process.exit(1)'

/** 仅接受版本化 NAS 镜像，禁止用浮动标签发布另一个浮动标签。 */
export function validateReleaseVersion(version) {
  if (!/^\d+\.\d+\.\d+-nas\.\d+$/.test(version ?? '')) {
    throw new Error('NAS 版本号应为 1.0.0-nas.1 这样的明确版本')
  }
  return version
}

/** 索引必须各含一个带有效摘要的 Linux amd64、arm64 镜像。 */
export function requireNasPlatforms(index) {
  return ['amd64', 'arm64'].map(architecture => {
    const matches =
      index?.manifests?.filter(
        item =>
          item.platform?.os === 'linux' &&
          item.platform.architecture === architecture
      ) ?? []
    if (
      matches.length !== 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(matches[0]?.digest ?? '')
    ) {
      throw new Error(`索引必须包含唯一且有效的 linux/${architecture} 镜像`)
    }
    return matches[0]
  })
}

async function docker(...args) {
  const { stdout } = await exec('docker', args, {
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout.trim()
}

async function indexDigest(reference) {
  const digest = await docker(
    'buildx',
    'imagetools',
    'inspect',
    reference,
    '--format',
    '{{.Manifest.Digest}}'
  )
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error(`无效镜像索引摘要：${digest}`)
  return digest
}

/** 启动后等健康检查通过；启动中退出或转为 unhealthy 直接判失败。 */
async function waitHealthy(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = JSON.parse(
      await docker('inspect', '--format', '{{json .State}}', name)
    )
    if (!state.Running || state.Health?.Status === 'unhealthy') break
    if (state.Health?.Status === 'healthy') return
    await setTimeout(2_000)
  }
  throw new Error(`健康检查未通过\n${await docker('logs', name)}`)
}

/**
 * 拉取镜像并启动，确认健康、PID 1 非 root、NAS 接口冒烟通过。
 *
 * CI 在各架构自己的 runner 上验证（不带 platform，不传 anonymousArgs）；
 * 本机发布工具用 platform 指定远端架构，并用 anonymousArgs 走无凭据的 Docker 配置，
 * 同时验证公开可拉取。
 */
export async function verifyNasImage(
  reference,
  { platform, anonymousArgs = [] } = {}
) {
  const label = platform ? `linux/${platform.split('/').pop()}` : '本机架构'
  const name = `yingbox-release-${randomUUID()}`
  const platformArgs = platform ? ['--platform', platform] : []
  console.log(`验证 ${label}`)
  await docker(...anonymousArgs, 'pull', ...platformArgs, reference)
  let created = false
  try {
    await docker(
      'create',
      ...platformArgs,
      '--name',
      name,
      '-e',
      'YINGBOX_HOST=0.0.0.0',
      '-e',
      'YINGBOX_AUTOGRAB=off',
      reference
    )
    created = true
    await docker('start', name)
    await waitHealthy(name)
    await docker('exec', name, 'node', '-e', NON_ROOT_CHECK)
    await docker('exec', name, 'node', 'docker/smoke-nas.mjs')
    console.log(`${label} 健康、非 root、NAS 接口冒烟通过`)
  } finally {
    if (created) await docker('rm', '-f', '-v', name)
  }
}

/** 取候选版本摘要、核对双架构，并打印 stable 当前指向。 */
async function resolveCandidate(version) {
  validateReleaseVersion(version)
  const digest = await indexDigest(`${repository}:${version}`)
  const index = JSON.parse(
    await docker(
      'buildx',
      'imagetools',
      'inspect',
      `${repository}@${digest}`,
      '--raw'
    )
  )
  const platforms = requireNasPlatforms(index)
  console.log(`候选 ${version}: ${digest}`)
  try {
    console.log(`当前 stable: ${await indexDigest(`${repository}:stable`)}`)
  } catch (error) {
    if (!/not found|manifest unknown/i.test(error.message)) throw error
    console.log('当前尚未发布 stable')
  }
  return { digest, platforms }
}

/**
 * 把 stable 指向已验证的版本索引，并核对提升结果。
 *
 * 调用方必须已经验证过两个架构：CI 在每个架构自己的 runner 上验证，
 * 本机发布工具用 publishNas 逐架构匿名验证。提升后的核验失败会报错，不自动回滚。
 */
export async function promoteNasStable(version, knownDigest) {
  const digest = knownDigest ?? (await resolveCandidate(version)).digest
  const reference = `${repository}@${digest}`
  await docker(
    'buildx',
    'imagetools',
    'create',
    '--tag',
    `${repository}:stable`,
    reference
  )
  const published = await indexDigest(`${repository}:stable`)
  if (published !== digest)
    throw new Error(`stable 摘要核对失败：期望 ${digest}，实际 ${published}`)
  console.log(
    JSON.stringify({ version, stable: `${repository}:stable`, digest }, null, 2)
  )
}

/** 本机发布：匿名拉取验证两个架构后推进 stable，再匿名核对 stable 可拉取。 */
export async function publishNas(version) {
  const { digest, platforms } = await resolveCandidate(version)
  const reference = `${repository}@${digest}`
  const anonymousConfig = await mkdtemp(
    join(tmpdir(), 'yingbox-release-anonymous-')
  )
  try {
    const daemonHost =
      process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
        ? process.env.DOCKER_HOST
        : await docker(
            'context',
            'inspect',
            '--format',
            '{{.Endpoints.docker.Host}}'
          )
    const anonymousArgs = ['--config', anonymousConfig, '--host', daemonHost]
    const daemonId = await docker('info', '--format', '{{.ID}}')
    if (
      (await docker(...anonymousArgs, 'info', '--format', '{{.ID}}')) !==
      daemonId
    ) {
      throw new Error('匿名拉取连接的 Docker daemon 与当前发布环境不同')
    }
    for (const platform of platforms) {
      await verifyNasImage(`${repository}@${platform.digest}`, {
        platform: `linux/${platform.platform.architecture}`,
        anonymousArgs,
      })
    }
    await promoteNasStable(version, digest)
    for (const platform of platforms) {
      const output = await docker(
        ...anonymousArgs,
        'pull',
        '--platform',
        `linux/${platform.platform.architecture}`,
        `${repository}:stable`
      )
      if (!output.includes(`Digest: ${digest}`))
        throw new Error('stable 匿名拉取摘要不一致')
    }
    console.log('stable 匿名拉取核对通过')
  } finally {
    await rm(anonymousConfig, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  publishNas(process.argv[2]).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
