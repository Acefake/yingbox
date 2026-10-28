# ADR-0021 磁力来源（PanSou 磁力 + Torznab）与 115 离线下载

- 状态：已采纳（2026-10-26；离线下载一节同日补充）
- 相关：ADR-0020（片库服务承载 115 网盘、追更与库外发现）

## 背景

网盘搜索只问 PanSou 的 115 分享，资源偏少。PanSou 本身能返回磁力（`magnet`）和电驴（`ed2k`）链接；用户 NAS 上还部署了
Prowlarr / Jackett，两者都提供 Torznab 接口，能搜 BT 站的磁力。115 的云下载（离线下载）支持磁力和电驴，下载完的文件就在
用户自己的 115 里，可以沿用现有的「115 → CloudDrive2 挂载 → 片库」入库链路。

## 决策

- **两个磁力来源，一次搜索并发问**：界面搜索时 PanSou 的 `cloud_types` 改为 `115 + magnet + ed2k`，同时问设置里的 Torznab 接口
  （`src/main/pan115/sources.ts`）。一个来源失败只在结果里记一条说明（`notes`），另一个照常出结果；全部失败才整体失败。追更类
  自动化仍只要 115 分享（`searchRaw`），请求体不变。
- **结果模型**：115 分享仍是 `NetdiskItem`；磁力是 `MagnetItem`（来源 `pansou` / `torznab`、来源细节、链接、哈希、大小、做种、下载人数、时间）。
  按 `kind + 哈希` 去重（btih 统一成小写十六进制，base32 先转换），同哈希 Torznab 的那条优先、缺的字段互补；按做种数、大小降序，最多 100 条
  （`magnet-link.ts`）。
- **Torznab**：地址可填多个（一行一个，最多 8 个；Prowlarr 每个索引器一个，Jackett 可用聚合接口 `/api/v2.0/indexers/all/results/torznab/api`），
  只填主机时补 `/api`。有 imdbid / tmdbid 时用 `t=movie` / `t=tvsearch` 并带上，索引器回 201–203（参数 / 功能不支持）时退回 `t=search`。
  每条优先取 `magneturl` / `magnet:` 链接 / `infohash`；只有 `.torrent` 下载地址的，按做种数取前 10 条解析：同主机 302 到 `magnet:` 就用它，
  返回种子就算 infohash（`torrent.ts`，bencode 取 info 原文 SHA-1），下载地址不在接口那台主机上的不碰。XML 用正则逐条取字段，不引 XML 库。
- **出网范围**：PanSou 与 Torznab 都是用户填的局域网地址，不做私网拦截；重定向手动跟，只允许同一主机，跳到 `magnet:` / `ed2k://` 时停下当结果
  （`http.ts` 的 `sameHostFetch`，PanSou 原来的实现挪过来共用）。
- **API Key 存储**：Torznab 地址与 Key 一起存一个密钥 `pan115.torznab`（JSON）——桌面端 safeStorage，服务端 `secrets.json`，与 115 会话同一种存储；
  渲染层只拿到地址与 `hasKey`（契约 `pan115.torznab / setTorznab / testTorznab`），Key 只写不读。服务端可用 `YINGBOX_TORZNAB_URL` /
  `YINGBOX_TORZNAB_API_KEY` 兜底（文件里没存时）。「测试连接」发 `t=caps`，每个地址回一行结果。
- **界面**：网盘页用分段控件切「115 分享 / 磁力」；磁力行显示来源标签（磁力 · PanSou / 磁力 · Torznab / 电驴 · PanSou）、来源细节、大小、做种、
  日期和规格标签（`releaseSpecs`）。

## 决策：115 离线下载

- **接口选择**：添加任务用 115 客户端的 `POST https://clouddownload.115.com/lixianssp/?ac=add_task_urls`，表单 `data` 是 m115 编码的
  `{ ac, app_ver, uid, url[i], wp_path_id }`，响应 `data` 同样编码（逐条结果，errcode 10008「已存在」算成功）。网页端旧接口 `115.com/web/lixian`
  已提示「请升级新版本的 115 客户端」，所以不用。任务列表用明文的 `GET /web/?ac=task_lists`。两个接口都先试 `clouddownload.115.com`，
  404 或不是 JSON 时退回旧域名 `lixian.115.com`。请求带 115 客户端 UA（`115Browser/36.2.28`），传输层看到 `115Browser`
  时保留它，其余 115 请求仍换成桌面 Chrome UA。
- **m115 编码**（`src/main/pan115/m115.ts`）：移植自 elevengo 的 `internal/crypto/m115`（MIT），随机 16 字节种子 + 两轮异或 / 反转，再用 115 公钥
  做 RSA（PKCS#1 v1.5）分块加密；响应用公钥做模幂、去填充后反向还原。单测用自己生成的密钥对模拟服务端，验证请求与响应往返。
- **模块**（`src/main/offline/`，桌面端主进程与片库服务共用，只依赖模块宿主）：契约域 `offline`（`add(links)`、`tasks()`、事件 `changed`）。
  保存目录是网盘设置的转存目标 `pan115.targetCid`；只记、只跟进经影盒添加的任务（`<dataDir>/offline-tasks.json`，最多 100 条，结束 30 天后清掉）。
  每 3 分钟一轮，有未完成任务（等待 / 下载中，或已完成未入库）时才查 115 列表（最多 5 页），否则不发请求；界面打开「离线任务」时也同步一次
  （两次至少隔 15 秒）。完成的任务按「保存目录路径 / 任务名」调 `notifyChanges`（映射 `library.notify.mountRoot`），失败下一轮再试；
  翻完列表仍找不到、且添加超过 10 分钟的任务记为失败。
- **界面**：磁力行加「115 离线下载」按钮（未登录 115 时提示并打开设置 · 网盘扫码）；网盘页第三段「离线任务」显示进度条、状态、是否已入库、失败原因。
  网页端（NAS）走同一契约。
- **后续（本次不做）**：剧集追更、洗版用磁力；电影上线追踪在没有 115 分享时用 Torznab 自动离线下载（可选开关）。

## 后果

- 一次界面搜索最多多出 N 个 Torznab 请求（N = 地址数）和至多 10 个种子下载请求，都只发往用户填的主机。Jackett 聚合全部索引器时较慢，超时给到 45 秒。
- Torznab 的 Key 会出现在发往 Prowlarr / Jackett 的请求地址里（Torznab 协议如此），只在主进程 / 服务端拼接，不进渲染层与日志。
- Prowlarr 没有跨索引器的 Torznab 聚合接口，用户要按索引器逐个填地址（或在 Prowlarr 里用同一个 Key、复制各索引器的 Torznab 地址）。

- **离线下载的风险**：115 云下载接口没有在真实账号上验证（沙箱出口在海外，连不上 115），字段形状仍需实测核对；
  客户端版本号 `36.2.28` 可能过旧，115 会以「请升级客户端」之类的错误拒绝，届时改 `CLIENT_VERSION`；任务列表的失败原因字段名（`err_msg` /
  `error_msg` / `fail_reason`）是推测，取不到时显示「115 没给失败原因」。真实账号上第一次使用时应核对 115 App 的云下载列表。
- 115 离线有月度配额，失败、重复添加都由 115 判定，影盒不做配额统计。

## 否决方案

- **引 XML 解析库**：Torznab 的 RSS 结构固定、字段少，正则足够，省一个依赖和打包体积。
- **渲染层直接请求 Torznab**：Key 会进浏览器；网页端还会遇到跨域与混合内容，统一走主进程 / 服务端。
- **搜索时解析全部 .torrent 地址**：私有站结果多时请求量过大，按做种数只解析前 10 条。
- **网页端旧离线接口（`115.com/web/lixian`）**：已提示升级客户端，不再可用。
- **离线任务完成后由 CD2 webhook 入库**：要用户另配 webhook 模板；影盒自己知道保存目录和任务名，直接通知更省事，CD2 的通知仍可并存。
