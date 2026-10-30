/** 本机验证已发布的双架构 NAS 镜像后，将 stable 指向同一不可变索引。 */
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

async function verifyPlatform(reference, architecture, anonymousArgs) {
  const name = `yingbox-release-${architecture}-${randomUUID()}`
  console.log(`验证 linux/${architecture}`)
  await docker(
    ...anonymousArgs,
    'pull',
    '--platform',
    `linux/${architecture}`,
    reference
  )
  let created = false
  try {
    await docker(
      'create',
      '--platform',
      `linux/${architecture}`,
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
    let healthy = false
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = JSON.parse(
        await docker('inspect', '--format', '{{json .State}}', name)
      )
      if (!state.Running || state.Health?.Status === 'unhealthy') break
      if (state.Health?.Status === 'healthy') {
        healthy = true
        break
      }
      await setTimeout(2_000)
    }
    if (!healthy)
      throw new Error(
        `linux/${architecture} 健康检查未通过\n${await docker('logs', name)}`
      )
    await docker(
      'exec',
      name,
      'node',
      '-e',
      'const s=require("node:fs").readFileSync("/proc/1/status","utf8");const uid=s.match(/^Uid:\\s+(\\d+)/m)?.[1];if(!uid||uid==="0")process.exit(1)'
    )
    await docker('exec', name, 'node', 'docker/smoke-nas.mjs')
    console.log(`linux/${architecture} 健康、非 root、NAS 接口冒烟通过`)
  } finally {
    if (created) await docker('rm', '-f', '-v', name)
  }
}

/** 候选验证成功才提升稳定标签；提升后的核验失败会报错，不自动回滚。 */
export async function publishNas(version) {
  validateReleaseVersion(version)
  const digest = await indexDigest(`${repository}:${version}`)
  const reference = `${repository}@${digest}`
  const index = JSON.parse(
    await docker('buildx', 'imagetools', 'inspect', reference, '--raw')
  )
  const platforms = requireNasPlatforms(index)
  console.log(`候选 ${version}: ${digest}`)
  try {
    console.log(`当前 stable: ${await indexDigest(`${repository}:stable`)}`)
  } catch (error) {
    if (!/not found|manifest unknown/i.test(error.message)) throw error
    console.log('当前尚未发布 stable')
  }
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
      await verifyPlatform(
        `${repository}@${platform.digest}`,
        platform.platform.architecture,
        anonymousArgs
      )
    }
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
    console.log(
      JSON.stringify(
        { version, stable: `${repository}:stable`, digest, platforms },
        null,
        2
      )
    )
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
