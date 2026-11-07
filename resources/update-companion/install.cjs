/** 更新安装阶段；旧版本退出失败时停止，避免无限等待或带占用安装。 */
async function runInstallation(config, deps) {
  const started = deps.now()
  deps.stage('exiting')
  await deps.log(`等待旧版本退出 pid=${config.parentPid}`)
  while (deps.parentAlive(config.parentPid)) {
    if (deps.now() - started >= 30_000)
      throw new Error(
        '旧版本未能退出，尚未开始安装。请退出影盒并重新打开，再重试更新。'
      )
    await deps.sleep(100)
  }
  await deps.log(`旧版本已退出，等待耗时 ${deps.now() - started}ms`)
  deps.stage('installing')
  const installing = deps.now()
  const args = [...new Set([...config.args, '/S', '--yingbox-update-ui'])]
  await deps.install(config.installer, args)
  await deps.log(`安装器完成，安装耗时 ${deps.now() - installing}ms`)
  deps.stage('starting')
}

module.exports = { runInstallation }
