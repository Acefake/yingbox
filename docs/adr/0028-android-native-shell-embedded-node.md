# ADR-0028 安卓与安卓电视端：原生界面，内嵌 Node 服务，原生播放内核

- 日期：2026-11-01
- 状态：已采纳
- 相关：ADR-0010（Node 服务容器化）、ADR-0016、ADR-0017（杜比视界）、ADR-0018（播放器窗口）、ADR-0026（各端功能一致）

## 背景

要在安卓手机和安卓电视上提供影盒：装好即用（不依赖电脑或 NAS）、保留首页、最近观看、收藏、本地播放与刮削、有杜比视界解码和强播放能力。发布方式是 APK 侧载，开源，一个人维护。

仓库现状：

- `src/server` 不依赖 Electron，NAS 版已经用它加网页版跑出和桌面一致的功能（ADR-0010、ADR-0026）。它只用纯 JS / wasm 和 `node:sqlite`，Dockerfile 已按 amd64 / arm64 同一份代码构建。
- 在线首页、选源、详情匹配、收藏、进度等业务逻辑大量写在渲染层（`features/online` 约 5k 行 TS，`features/player`、`features/library` 各约 10k 行），服务端只暴露 `/api/domains/:domain/:method`、`/api/library/rpc` 这类通用 RPC；收藏、在线进度、已看存在浏览器 localStorage（`media_favorites`、`media_play_progress`、`media_watched`）。
- 网页端没有杜比视界重建，P5 只能直接播并提示（ADR-0017）；杜比视界要在安卓上正确输出，只能走系统 MediaCodec 硬解。
- 项目不使用 GitHub Actions，构建和发布在本机完成（ADR-0025）。

电视的遥控器交互是硬要求。WebView 套网页界面的方案（复用 `dist-web`）已评估，焦点导航和远距离布局难以做到原生水准，被否决。

## 决策

1. **一个 APK，手机和电视共用。** 界面用 Kotlin + Jetpack Compose，按电视遥控器焦点交互设计；手机复用同一批页面和 ViewModel，只在布局层按窗口尺寸与设备类型区分（导航栏位置、海报尺寸、播放控制方式）。
2. **后端复用 `src/server`，内嵌 Node 24（nodejs-mobile 完整版）。** 在前台服务里运行，只监听 `127.0.0.1` 的随机端口，令牌每次安装生成一次，沿用 ADR-0010 的回环加令牌规则。ffprobe / ffmpeg 自行编译 arm64-v8a 与 armeabi-v7a 版本，放进 `jniLibs`，从 `nativeLibraryDir` 执行。
3. **业务逻辑上移服务端。** 渲染层里不依赖 Vue 的纯逻辑（首页分区、浏览筛选、聚合搜索、详情与 TMDB / 豆瓣匹配、选源与解析播放地址）搬进共享代码，在服务端新增 `app` 视图域，返回“已经做好的数据”；原生界面只展示和交互。网页端与桌面端在搬迁过程中改为复用同一份逻辑，不留两份实现。视图接口的结果类型只在一处用 TS 定义，构建时生成 JSON Schema 和 Kotlin 数据类，类型漂移时构建失败。视图域的具体接口另立 ADR。
4. **收藏、进度、已看、最近观看存服务端 sqlite**，与片库进度同库；桌面旧 localStorage 数据的导入放第二期。
5. **播放器是原生的**，以 Media3 ExoPlayer 为主、libmpv 兜底，选内核复用 `shared/video-range.ts` 的 `needsDvColorFix` / `parseFfprobeVideo`，不另写一套判定。播放进度、已看、继续播放沿用 `features/player/progress/progress-events.ts` 的语义，落到服务端对应接口，原生播放器和桌面、网页的行为一致。杜比视界按设备解码能力分流：
   - 设备有杜比视界解码：P5、P8.1 硬解输出杜比视界；P7 用 libdovi 逐帧转成 P8.1 再硬解（增强层丢弃）。
   - 设备没有：P5 由 mpv 的 libplacebo 按 RPU 映射为 HDR10 或 SDR；P8.1、P7 按 HDR10 基础层播放。
   - 设置里提供“杜比视界输出”开关，播放信息面板显示“源 Profile → 实际输出”。
6. **仓库布局：放在本仓库的 `android/` 目录**，不拆新仓库。`android/` 不进 pnpm workspace；ESLint、Prettier、`check:size` 不覆盖它，Kotlin 用自己的 ktlint / detekt。构建脚本 `build:android` 先跑 `build:server`，再把 `out/server` 放进 APK 资源，APK 不含 `dist-web`。构建和发布在本机完成，不加 GitHub Actions；标签用 `android-vX.Y.Z`，与桌面版本分开发布到 GitHub Releases。
7. **v1 范围**：首页、搜索、详情与选源、播放、最近观看、继续播放、收藏、电影库与剧集库（加目录、扫描、刮削、手动修正匹配、本地播放）、设置。下载、直播、日历、网盘、追更、115、AI 字幕、弹幕、远程连 NAS 的模式放第二期，对应入口在原生端先隐藏。
8. **安卓上关闭的服务端能力**：依赖 `onnxruntime-node` 的视觉功能，桌面 mpv 窗口，libplacebo 重建（ADR-0017，安卓改由原生播放器处理）。用 `src/server/features.ts` 的开关关闭。
9. **第一步是可行性验证（P0）**，通过前不开始大规模搬迁。验证项：nodejs-mobile 在最低配盒子和手机上跑起 `src/server` 并通过 `smoke:server`；Compose 空壳读到 `/api/info`；ffprobe 能从 `nativeLibraryDir` 执行；ExoPlayer 在有杜比视界解码的设备上播出 P5 与 P8.1。任一项做不成，回到本 ADR 重新评估，不硬推。

## 后果

- 电视遥控器体验是第一优先，手机直接复用。代价是界面要用 Compose 重写一遍，工作量大；v1 范围因此收窄，第二期功能不做半成品。
- 搬迁业务逻辑是地基，也让网页端、桌面端受益，但会同时改动桌面代码，需要每一步都有测试守着，不能把行为改坏。
- APK 带 Node 运行时、ffmpeg 与 libmpv，体积和内存占用都比纯原生应用大；2 GB 内存盒子的启动时间和内存要实测，必要时降低扫描并发，并在首页先显示缓存。
- 杜比视界在不同设备上表现差异大，P7（尤其是 FEL）依赖设备解码器，只能按设备建测试矩阵验收，不能承诺所有设备都触发杜比视界。
- 侧载申请“所有文件访问”权限，Node 直接读真实路径；不走 SAF 的 `content://`。SMB 片源 v1 不做，网络片源先用已有的 WebDAV。
- 许可证：优先 LGPL 构建的 FFmpeg 与 libmpv，避免 GPL 组件；若不得不引入，`android/` 单独声明范围。需要更新 `THIRD_PARTY_NOTICES.md`。
- 系统 WebView 不再是依赖，旧盒子的 WebView 版本问题随之消失。
- 本地构建意味着没有自动化 CI 兜底：改 `src/server`、`src/shared` 的提交要在本机同时跑桌面检查与 `build:android`。
- 以后若 Kotlin 端有独立贡献者或需要独立许可证，可以用 `git subtree split` 把 `android/` 拆出去。

## 否决方案

- **WebView 加载 `dist-web`（沿用网页界面）**：复用最多、最快，但电视焦点导航和远距离布局难以做到位，已被否决。
- **用 Kotlin 重写全部后端**：片库、刮削、在线引擎、插件运行时（QuickJS）都要重写，一个人做不完，而且之后要维护两套行为。
- **原生界面 + 逻辑留在网页层、Kotlin 再抄一份**：短期快，但两份逻辑迟早分叉。
- **薄客户端连 NAS 或电脑**：不满足“装好就能用”；作为第二期的附加模式保留，复用同一套 HTTP 接口。
- **新开独立仓库**：视图接口、共享类型、服务端打包都在本仓库，分仓库会让每次改接口都要跨仓库对齐版本，一个人维护成本更高。
- **加 GitHub Actions 做路径过滤的 CI**：与 ADR-0025“本机构建发布”的既有决定冲突。
- **SAF（`content://`）访问存储**：Node 读不了，要在 Kotlin 侧为每种操作做代理，侧载应用不需要受这个限制。
