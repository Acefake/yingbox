/** 将服务构建整理为可搬离仓库安装的目录与 tgz；不发布到 npm。 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 保持 out/server 与 dist-web 的相对位置，网页自动发现不依赖启动目录。 */
export async function stageServerPackage(root, withWeb = false) {
  const source = join(root, 'out/server')
  const manifest = JSON.parse(
    await readFile(join(source, 'runtime-package.json'), 'utf8')
  )
  await Promise.all(
    ['server.js', 'engine.js', 'webp-worker.js'].map(file =>
      access(join(source, file))
    )
  )
  if (withWeb) await access(join(root, 'dist-web/index.html'))
  if (withWeb) manifest.name = 'yingbox-server-web'
  const target = join(root, 'out/packages', manifest.name)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, join(target, 'out/server'), {
    recursive: true,
    filter: path =>
      !path.endsWith('.map') && basename(path) !== 'runtime-package.json',
  })
  if (withWeb)
    await cp(join(root, 'dist-web'), join(target, 'dist-web'), {
      recursive: true,
    })
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses'])
    await cp(join(root, file), join(target, file), { recursive: true })
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  await writeFile(
    join(target, 'README.md'),
    `# 影盒独立后端

需要 Node.js 22.13 或更高版本。解压后在本目录执行：

\x60\x60\x60bash
npm install --omit=dev
npm start -- --data-dir ./data --media-root /你的媒体目录
\x60\x60\x60

访问 http://127.0.0.1:31480${withWeb ? '，网页和 API 使用同一地址' : '/api/health；本包只提供 API，不含网页'}。
可从任意目录用 \x60node /安装路径/out/server/server.js\x60 启动；相对配置路径以工作目录为准。

局域网访问加 \x60--host 0.0.0.0\x60。设置环境变量 \x60YINGBOX_SERVER_TOKEN\x60 开启访问令牌；
对外监听时令牌至少 24 个字符。未设置令牌时所有能连接服务的设备都可访问。
HTTPS 反向代理设置 \x60YINGBOX_PUBLIC_ORIGIN=https://你的域名\x60。

本包${withWeb ? '内含网页，可用 --web-dir off 只提供 API' : '可用 --web-dir /网页目录 托管单独构建的 dist-web'}。
数据目录包含数据库、密钥和任务状态，更新程序时请保留并备份。

FFmpeg / ffprobe 为可选外部程序，可用 YINGBOX_FFMPEG / YINGBOX_FFPROBE 指定路径。
按画面搜索使用可选的 onnxruntime-node；安装失败不影响片库与网盘。
本包没有 Electron、构建工具或桌面安装脚本，不提供实时视频转码。
完整配置见 ${manifest.homepage}/blob/main/docs/library-server.md。
`
  )
  return target
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--with-web'))
    throw new Error('仅支持 --with-web 参数')
  const target = await stageServerPackage(ROOT, args.includes('--with-web'))
  const destination = join(ROOT, 'out/packages')
  // Windows 下 .cmd 经命令解释器启动；命令为固定字符串，不插入路径。
  const npmCli = process.env.npm_execpath
  if (process.platform === 'win32' && !/npm-cli\.js$/.test(npmCli ?? '')) {
    execFileSync(
      process.env.ComSpec || 'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'npm pack --ignore-scripts --loglevel error --pack-destination ..',
      ],
      { cwd: target, stdio: 'inherit' }
    )
  } else if (!npmCli || !/npm-cli\.js$/.test(npmCli)) {
    execFileSync(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--loglevel',
        'error',
        '--pack-destination',
        destination,
      ],
      { cwd: target, stdio: 'inherit' }
    )
  } else {
    execFileSync(
      process.execPath,
      [
        npmCli,
        'pack',
        '--ignore-scripts',
        '--loglevel',
        'error',
        '--pack-destination',
        destination,
      ],
      { cwd: target, stdio: 'inherit' }
    )
  }
  console.log(`独立服务目录：${target}`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
