# 安卓发版

手机和电视安装同一个包。常见 ARM64 手机、电视盒子使用 `arm64-v8a`，x86_64 设备和模拟器使用 `x86_64`；不提供 ARMv7 包。

## 保管签名

本机首版签名保存在 `D:\soft\yingbox-keys\yingbox-android-release.jks`，配置备份为同目录的 `keystore.properties.bak`。将这个目录备份到可信的离线位置。仓库内的 `android/keystore.properties` 及密钥文件均不提交。

构建机需要 Android SDK、Android Studio JBR、Node 和已安装的项目依赖。将签名配置放入 `android/keystore.properties`，字段为 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。`storeFile` 使用密钥的绝对路径。

## 构建并发布

1. 修改 `android/version.properties` 中的 `versionName`。使用递增的 `x.y.z`，y、z 不超过 99。
2. 提交本次版本源码，使发布标签指向可重建的代码；不要提交密钥或本机 Gradle JVM 配置。
3. 构建和校验：`node scripts/android-release.mjs`。产物在 `out/android-release/<版本>/`。
4. 公开发布：`node scripts/android-release.mjs --publish`。需要本机 `gh auth status` 已登录且有本仓库发布权限。脚本先创建草稿、上传两份 APK 和校验清单，完成后公开为 Pre-release。已公开的同名版本不能覆盖。

安装包必须通过 `apksigner`；签名与 `android/release-certificate.sha256` 中的固定公开指纹一致，版本码和版本名与配置一致。该指纹不含密钥。脚本创建标签后会解引用核对远端提交，不覆盖指向其他代码的同名标签。下载后可用 `Get-FileHash <apk> -Algorithm SHA256` 与 `SHA256SUMS.txt` 对照。

## 验证应用内升级

首次安装正式版本后，设置 → 关于 → 检查更新。启动检查每六小时至多成功一次，手动检查不受此限制。下载完成后如出现授权页，允许影盒安装应用，返回点「继续安装」，再在系统界面确认。

本机覆盖测试可用 `android/gradlew.bat :app:assembleRelease -PsplitAbi '-PappVersionName=0.0.9'` 构建较旧的同签名测试包；它不上传发布。安装该包后更新到正式版，核对版本、设置和继续观看数据。先前调试签名包不能覆盖为正式签名，避免为测试卸载有价值的数据。
