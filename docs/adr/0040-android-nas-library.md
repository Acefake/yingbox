# ADR-0040 安卓连接 NAS 上的影盒：直调片库 RPC，直放文件

- 日期：2026-11-03
- 状态：已采纳
- 相关：ADR-0010（独立片库服务）、ADR-0026（NAS 版）、ADR-0028（安卓端方案，把「远程连 NAS」放在二期）、ADR-0034（明文只放行回环）、ADR-0039（播放内核）

## 背景

ADR-0028 把「远程连 NAS」放在二期。要让安卓播放 NAS 上的杜比视界、DTS、TrueHD 等文件，需要连上 NAS 上的影盒服务（`src/server`），浏览它的电影与剧集库并直放文件。NAS 版与安卓内嵌的是同一份服务，HTTP 接口一致：Bearer 令牌鉴权，`/api/library/rpc` 调片库方法，`/media/files/<fileId>` 出视频流（Range），`/media/subtitles/<fileId>` 出外挂字幕（WebVTT），`/media/image/<key>` 出海报。

## 决策

1. **直接调片库 RPC，不加 view 域方法。** 安卓与 NAS 的版本可能不同步，片库 RPC 与桌面端同一份契约、最稳定；view 域方法（ADR-0030）在旧 NAS 上可能不存在。只解析用到的字段，解析是纯函数，JVM 单元测试覆盖（`android/.../library/`）。
2. **两个服务端并存。** 内嵌服务继续负责在线源；NAS 是第二个 `ServerClient`，只负责片库与片库播放。设置里配了 NAS 导航才出现「片库」，在线功能不受影响。
3. **连接配置存设备设置**（ADR-0033）：地址与令牌，令牌存应用私有的 SharedPreferences（`allowBackup=false`，不备份）。「保存并测试」用 `GET /api/health` 区分已连接、连不上、令牌不对。
4. **明文 HTTP 放开。** NAS 通常是局域网里的 `http://192.168.x.x:端口`，地址由用户填，无法预先列出，所以网络安全配置从「只放行 127.0.0.1」改为 `base-config` 允许明文（部分取代 ADR-0034 决策里「其他地址保持系统默认」）。令牌随明文传输，只在可信局域网里使用；设置页的说明里写明。
5. **直放。** 播放地址 `/media/files/<fileId>`，播放器的 HTTP 工厂带 `Authorization`；外挂字幕作为 `MediaItem.SubtitleConfiguration`（WebVTT，id 以 `ext:` 开头，轨道列表里标「外挂」，第一条默认显示）。
6. **版本取服务端的 `versions`**（已按分辨率、动态范围、体积排好，第一个是默认）。没有 `versions` 的旧服务退回每个视频文件一个版本。分段版本（CD1 / CD2）目前只播第一段。
7. **进度写回 NAS 的片库**：开播前 `progress.list` 取续播位置，播放中每 5 秒与暂停、退出、播完时 `progress.save`。进度读不到时不开播（不能当成从头播，否则暂停就会覆盖 NAS 上已有进度）；进度记的是另一个版本（`fileId` 不同）时从头播。退出播放器后详情页先等排队的写入发完再读进度。
8. **播放界面拆共用部分。** `PlayerState`（创建播放器、统计、降级提示、错误）与 `PlayerHost`（画面、遥控器、浮层）由在线播放（`PlayerScreen`）与片库播放（`LibraryPlayerScreen`）共用；两者各管自己的来源与进度。

## 后果

- 分段版本只能播第一段，多段连播与跨段进度留给后续（需要播放列表加累计位置）。
- 全局放开明文：应用里所有 `HttpURLConnection` 与 ExoPlayer 都允许明文，包括在线内容里的 http 直连地址。令牌明文传输的风险由用户的网络环境承担。
- 片库页的类型、搜索词、已加载的海报和滚动位置保存在页面栈外的 `LibraryBrowse` 里，换 NAS 配置时重建。
- 不在本 ADR 范围：WebDAV / SMB 直连（B2）、新的控制层界面（C）、P5 服务端重建（D）。

## 否决方案

- **view 域方法**：每个页面一个服务端方法加生成 Kotlin 类型，一致性好，但 NAS 版本落后时整页不可用，片库 RPC 是更稳定的接口。
- **只放行局域网网段的明文**：`network-security-config` 不能按网段放行，只能按域名；NAS 的地址形式（IP、`.local`、自定义域名）无法穷举。
- **把 NAS 当成内嵌服务的上游**：多一跳，且令牌、进度要两边同步。
