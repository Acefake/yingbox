# 安卓发版

手机和电视安装同一个包。常见 ARM64 手机、电视盒子使用 `arm64-v8a`，x86_64 设备和模拟器使用 `x86_64`；不提供 ARMv7 包。

安卓包随各端安装包一起发布在同一个 GitHub Release 里，流程见 [ADR-0038](../adr/0038-unified-github-release.md)。

## 保管签名

发布签名保存在 `C:\Users\10228\yingbox-keys\yingbox-android-release.jks`，配置在同目录的 `keystore.properties`（2026-11-03 重新生成；旧签名已丢失，用它签的 `0.1.0` 需卸载后重装）。将这个目录备份到可信的离线位置。仓库内的 `android/keystore.properties` 及密钥文件均不提交。

发布工作流从 GitHub Secrets 取签名：`ANDROID_KEYSTORE_BASE64`（密钥库文件的 base64）、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。工作流没有这些密钥时安卓任务失败，不会退回调试签名。

## 发布

1. 修改 `package.json` 的 `version`，提交。
2. 打标签并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`。标签必须与 `package.json` 版本一致。
3. 工作流构建各端，全部成功后公开 Release。任一端失败时 Release 保持草稿。

安卓的 `versionName` 取自标签，`android/version.properties` 在构建时由工作流写入，`versionCode = x*10000+y*100+z`。

## 本机验证

构建机需要 Android SDK、Android Studio JBR、Node 和已安装的项目依赖。将签名配置放入 `android/keystore.properties`，字段为 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。`storeFile` 使用密钥的绝对路径。

`node scripts/android-release.mjs` 按 `android/version.properties` 构建、校验并把两个 APK 放进 `out/android-release/<版本>/`。它校验 `apksigner` 签名、与 `android/release-certificate.sha256` 中固定公开指纹一致、包名、版本码、版本名和 ABI。该指纹不含密钥。

## 验证应用内升级

首次安装正式版本后，设置 → 关于 → 检查更新。启动检查每六小时至多成功一次，手动检查不受此限制。下载完成后如出现授权页，允许影盒安装应用，返回点「继续安装」，再在系统界面确认。

本机覆盖测试可用 `android/gradlew.bat :app:assembleRelease -PsplitAbi '-PappVersionName=0.0.9'` 构建较旧的同签名测试包；它不上传发布。安装该包后更新到正式版，核对版本、设置和继续观看数据。先前调试签名包不能覆盖为正式签名，避免为测试卸载有价值的数据。
