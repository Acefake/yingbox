# ADR-0021 磁力来源（PanSou 磁力 + Torznab）

- 状态：已采纳（2026-10-26）
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

## 后果

- 一次界面搜索最多多出 N 个 Torznab 请求（N = 地址数）和至多 10 个种子下载请求，都只发往用户填的主机。Jackett 聚合全部索引器时较慢，超时给到 45 秒。
- Torznab 的 Key 会出现在发往 Prowlarr / Jackett 的请求地址里（Torznab 协议如此），只在主进程 / 服务端拼接，不进渲染层与日志。
- Prowlarr 没有跨索引器的 Torznab 聚合接口，用户要按索引器逐个填地址（或在 Prowlarr 里用同一个 Key、复制各索引器的 Torznab 地址）。

## 否决方案

- **引 XML 解析库**：Torznab 的 RSS 结构固定、字段少，正则足够，省一个依赖和打包体积。
- **渲染层直接请求 Torznab**：Key 会进浏览器；网页端还会遇到跨域与混合内容，统一走主进程 / 服务端。
- **搜索时解析全部 .torrent 地址**：私有站结果多时请求量过大，按做种数只解析前 10 条。
