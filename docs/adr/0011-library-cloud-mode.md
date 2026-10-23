# ADR-0011 媒体库网盘模式与外部变更通知

- 状态：已采纳（2026-10-22）
- 相关：PR feat/library-cloud-mode；说明文档 docs/library-cloud-mode.md

## 背景

CloudDrive2 / rclone 这类网盘挂载盘上，每一次列目录、读文件都是一次网络请求：

- 目录监控的定时增量扫描（5 分钟一次整库遍历）在大网盘库上就是持续的大规模列目录；fs.watch 在挂载盘上要么没有事件、要么不完整；
- 扫描后的指纹任务读每个视频头尾各 64 KiB、悬停预览从片中拉视频，在挂载盘上会真的去下载；
- CloudDrive2 本身能在文件变化时发 webhook（会员功能，`webhook.toml` 的 `[file_system_watcher]`），比轮询及时也便宜。

## 决策

1. 每个库加「存储」设置 `automation.storage`：`auto`（默认）/ `local` / `cloud`。auto 沿用已有判定：根目录是 UNC，或 Linux 上 `statfs` 判为 nfs / cifs / fuse 等事件不可靠的文件系统（`scanner/fs-type.ts`），即按网盘处理；判定集中在 `engine/storage-mode.ts`，目录监控、悬停预览、读视频都用它。
2. 网盘模式：监控通道记为 `external`，不 fs.watch、不定时扫描、启动时不补扫；只靠外部变更通知与手动扫描入库（添加库时的首次扫描照常）。不读视频内容：后台指纹与移动检测的指纹跳过，悬停预览只给已缓存图片；识别时的时长探测与 OpenSubtitles 哈希按需读，经 `Pacer` 串行、两次之间至少隔 1 秒（`engine/cloud-reads.ts`）。网盘改回本地盘时补排一次指纹任务。
3. 外部变更通知：主进程本地 HTTP 端点 `POST /library/notify`（`src/main/library/notify/`），默认只监听 `127.0.0.1:47291`，可开局域网访问（0.0.0.0）；随机令牌（`?token=` 或 `Authorization: Bearer`）；端口被占用时换空闲端口并写回设置。请求体兼容 CloudDrive2 默认模板（`data[].action / source_file / destination_file`），另认通用 JSON `{ action, path, destination_path? }`（单个或数组）。端点经新 RPC `notifyChanges` 交给引擎。
4. 引擎侧（`engine/external-changes.ts`）：路径依次按「挂载目录 + 路径」「直接落在库下」「库目录末尾几段 = 路径开头几段（取段数最多且唯一的库）」对应到库；变化项的父目录（改名两头都要）进每库一个合批器，静默 2 秒交出、最长 10 秒，同目录合并，再排按目录的增量扫描。关了「监控文件夹」的库不收通知。
5. 设置：开关、局域网访问、端口、令牌、挂载目录是普通设置 `library.notify.*`（令牌不进 safeStorage：它本来就要明文填进 CloudDrive2 的配置，且 Linux 无密钥环时也要能用）；状态与换令牌走契约域 `libraryNotify`。

### 刮削字段优先级（记录现状，本次不改）

查了现有刮削：TMDB 库识别后整份写入条目元数据，用户手动匹配 / 锁定（`locked`）的条目后续识别不改匹配；写 NFO 时已有 NFO 可选「合并 / 覆盖」。「NFO > 官方 > 社区 > 其他、只填空字段、不覆盖用户编辑」这条统一的条目字段优先级链没有实现：识别时已有 NFO 只当识别线索（外部 ID、片名、年份，`shared/library/identify/nfo.ts`），简介 / 演职员等字段值以元数据源为准、不读 NFO；条目级也没有逐字段的用户编辑锁（只有整条匹配的 locked）。作为后续建议，不在本 ADR 范围。

## 后果

- 网盘库不再有周期性的整库遍历与视频读取；变化靠通知在约 2 秒后按目录入库。没有通知（非会员、网盘 App 里直接改的文件——CloudDrive2 只通知经它发生的改动）时要手动扫描。
- Windows 上 CloudDrive2 挂载的盘符判不出网盘，需要用户把存储选成「网盘」；Linux 上 FUSE 挂载会被 auto 判为网盘，NFS / SMB 库也随之不再定时扫描——要轮询的用户选「本地盘」即回到 fs.watch + 定时扫描。
- 通知路径对应靠末尾段对齐，库目录就是整个挂载根目录、或两个库末尾同名时对不上，需要填挂载目录。
- 端点只在桌面主进程里；独立片库服务（`src/server`）没有这个端点，网页端可直接调 `notifyChanges` RPC。

## 否决方案

- 按固定间隔继续轮询网盘、只把间隔调大：仍是整库列目录，且延迟更长。
- 订阅 CloudDrive2 的 gRPC 文件变化流：要额外的账号配置和 proto 依赖，webhook 已够用且其他工具也能发。
- 端点放进媒体库引擎进程：引擎会被重启，端点地址随之中断；主进程常驻，适合持有端口。
- 令牌存 safeStorage、渲染层只写不读：复制地址就得主进程代写剪贴板，Linux 无密钥环时还开不了；收益不抵复杂度。
