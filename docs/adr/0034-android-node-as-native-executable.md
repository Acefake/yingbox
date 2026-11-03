# ADR-0034 安卓端的 Node 作为原生可执行文件运行，不用 nodejs-mobile

- 日期：2026-11-02
- 状态：已采纳
- 取代：ADR-0028 决策第 2 条中「内嵌 Node 24（nodejs-mobile 完整版）」这一句；ADR-0028 其余决策不变
- 相关：ADR-0010（Node 服务容器化）、ADR-0025（本地构建发布）、ADR-0028（安卓端方案）

## 背景

ADR-0028 计划用 nodejs-mobile 的 Node 24 在 APK 内运行 `src/server`。2026-11-02 做 P0 验证时核对了 nodejs-mobile 的发布页：

- 正式发布的最高版本是 18.20.4（2024-10，2026-04 补过 16KB 页修复）。
- Node 22、24 只存在于未合并的 PR（#150、#151、#158），#158 已与主线冲突。

`src/server` 的片库依赖 `node:sqlite`，最低要求 Node 22.5（服务包声明 `>=22.13.0`），所以 nodejs-mobile 18 跑不起服务端。

同一天用 Termux 编好的安卓版 Node 26.13 做了替代验证（x86_64 模拟器，Android 16）：

- `adb shell` 里直接运行：`smoke:server` 的 15 步通过 14 步，包括 sqlite 片库、扫描识别、`fork` 出的在线引擎子进程、`worker_threads` 里的 wasm WebP 缩略图、SSE、Range 流。没过的那步是托管网页端，APK 不带 `dist-web`，不适用。
- 打进 APK：`libnode.so` 放在 `jniLibs`、开启 `useLegacyPackaging`，从 `applicationInfo.nativeLibraryDir` 用 `ProcessBuilder` 启动；服务约 1 秒就绪，界面用令牌读到 `/api/info`，引擎子进程返回 29 个内置站点。
- 两个问题：Termux 的 Node 动态链接 OpenSSL、ICU 等带版本号的库，而 `jniLibs` 只打包 `lib*.so`；它的 OpenSSL 默认去 Termux 前缀找根证书，HTTPS 全部失败，加 `--use-bundled-ca` 后恢复。

## 决策

1. **Node 是一个普通的安卓可执行文件。** 以 `libnode.so` 的名字放进每个 ABI 的 `jniLibs`，APK 开启 `useLegacyPackaging` 让系统解压到 `nativeLibraryDir`，由前台服务用 `ProcessBuilder` 作为子进程启动。安卓 10 起应用不能执行可写目录里的文件，`nativeLibraryDir` 是唯一可执行的位置；ffprobe、ffmpeg 用同一方式（ADR-0028 已经这样定）。
2. **正式发布用自己编译的 Node 24 LTS。** 用 Node 官方仓库的 `android-configure` 与 NDK 在 Linux 容器里交叉编译 arm64-v8a、armeabi-v7a、x86_64，OpenSSL、ICU、sqlite、zlib 等依赖全部静态链接，产物只依赖系统的 `libc`、`libm`、`libdl`，默认使用内置根证书。链接时按 16 KB 页对齐（`-Wl,-z,max-page-size=16384`），新设备可能使用 16 KB 页。构建脚本放在本仓库，本地执行（ADR-0025）。
3. **自己编译之前，开发构建用 Termux 的 Node 顶替。** `scripts/android/termux-node.mjs` 从 Termux 软件源下载 Node 及其依赖，去掉文件名里的版本号放进 `jniLibs`，并生成一份「带版本号的库名 → 打包文件名」清单；运行时在应用私有目录建同名符号链接，再用 `LD_LIBRARY_PATH` 指过去。符号链接指向 `nativeLibraryDir` 里的真实文件，不需要改 ELF。自己编译的版本出来后清单为空，这段逻辑不再生效，届时删掉脚本与清单处理。Termux 版本只用于开发和模拟器验证，不发布。
4. **启动参数固定带 `--use-bundled-ca`。** 对自己编译的 Node 这是默认行为，对 Termux 版本是必需的。
5. **服务进程和应用同生命周期。** 每次启动换一个随机端口、只监听 `127.0.0.1`；令牌每次安装生成一次，原生端用 `Authorization: Bearer` 访问（ADR-0010 的回环加令牌规则）。服务端代码打成 zip 放进 assets，按安装版本（`versionCode` 加安装时间）解压到私有目录，同一次安装只解压一次。界面离开 5 秒后停止服务，期间回来不重启；应用进程被杀时 node 随之结束，服务不由系统自动重建。

## 后果

- `src/server` 一行不改就能在安卓上运行；桌面、NAS、安卓用同一份服务端代码。
- Node 版本由我们自己跟进，安全更新要重新编译三个 ABI。编译要 Linux 或 Docker，Windows 上不能直接做。
- APK 体积：Termux 顶替时单个 x86_64 约 61 MB（node 50 MB、ICU 数据 33 MB，未压缩）；静态链接并裁剪 ICU（`--with-intl=small-icu` 或只保留中日英）后要重新测量。
- 内存：模拟器上服务与引擎两个 node 进程合计约 137 MB RSS。2 GB 盒子要实测，必要时引擎按需启动。
- 自己编译的 Node 出来之前，arm64 真机只能用 Termux 版本验证，那一版依赖 Termux 的动态库与 Termux 的发布节奏。

## 否决方案

- **nodejs-mobile 18 并把片库改为 sql.js 或 better-sqlite3**：安卓要单独维护一套存储层，与桌面、NAS 分叉；Node 18 已停止维护。
- **采用 nodejs-mobile PR #158 的 Node 24 分支**：分支无人维护、与主线冲突，等于接手一个分叉，还要自己维护它的 JNI 层。
- **把 Termux 版本直接用于发布**：依赖链里有十几个动态库，版本随 Termux 滚动，许可证和体积都不可控。
