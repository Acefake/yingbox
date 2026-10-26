# 媒体库网盘模式与 CloudDrive2 变更通知

决策与取舍见 [ADR-0011](adr/0011-library-cloud-mode.md)。

## 存储（每个文件夹）

媒体库设置 →「自动入库」→「存储」：

| 选项         | 行为                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动（默认） | UNC 路径（`\\nas\share`）或 Linux 上 nfs / cifs / fuse / 9p 等挂载判为网盘，其余按本地盘                                                                    |
| 本地盘       | 监听文件系统事件 + 每 5 分钟增量扫描兜底；正常算指纹、悬停预览播视频                                                                                        |
| 网盘         | 不监听、不定时扫描、启动不补扫；只按变更通知或手动扫描入库；不算指纹、悬停预览只轮播已缓存图片；识别时探测时长 / 算 OpenSubtitles 哈希按需、每次间隔 ≥ 1 秒 |

Windows 上 CloudDrive2 挂出来的盘符（如 `D:\CloudDrive`）判不出来，请手动选「网盘」。

## 变更通知端点

媒体库设置 →「网盘变更通知」→ 打开「接收变更通知」，点「复制」得到地址：

```
http://127.0.0.1:47291/library/notify?token=<随机令牌>
```

- 默认只监听 `127.0.0.1`；CloudDrive2 跑在 NAS / 另一台机器上时打开「允许局域网访问」（监听 `0.0.0.0`，地址里写本机局域网 IP）。
- 端口默认 47291，被占用时自动换一个空闲端口（地址会变，CloudDrive2 那边要跟着改）。
- 「换令牌」后旧地址立即失效（401）。
- 令牌也可以放在请求头 `Authorization: Bearer <令牌>`。

### CloudDrive2 配置

CloudDrive2 网页「设置 → Webhook → 添加 Webhook」（或配置目录里的 `webhook.toml`），保留默认 body 模板，只改 `[file_system_watcher]`：

```toml
[file_system_watcher]
url = "http://127.0.0.1:47291/library/notify?token=<随机令牌>"
method = "POST"
enabled = true
```

默认 body 模板（每条 `data` 有 `action`、`is_dir`、`source_file`、`destination_file`）原样可用。`[mount_point_watcher]` 的挂载事件发到同一地址也会被忽略。

### 通用 JSON

其他工具 / 脚本可以发：

```json
{ "action": "create", "path": "/mnt/cd2/115/电影/A (2001)/A.mkv" }
```

或数组 `[{ "action": "rename", "path": "/a/x.mkv", "destination_path": "/a/y.mkv" }]`。

| 字段     | CloudDrive2               | 通用 JSON          | 说明                                                                          |
| -------- | ------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| 动作     | `data[].action`           | `action`           | `create` / `modify` / `delete` / `rename`（含移动），大小写不限；其他动作忽略 |
| 路径     | `data[].source_file`      | `path`             | 变化项；改名时是原路径                                                        |
| 目标路径 | `data[].destination_file` | `destination_path` | 只在 `rename` 时有值；空串忽略                                                |
| 是否目录 | `data[].is_dir`           | —                  | 不用：一律重读变化项的父目录，新目录从父目录完整下钻                          |

响应：`200 { "accepted": 对应到库的条数, "ignored": 对不上的条数 }`；令牌不对 401，不是 POST 405，格式不对 400，请求体超过 1 MiB 413，媒体库引擎不可用 503。

## 路径对应到库

通知里的路径可以是本机路径，也可以是 CloudDrive2 自己的路径（`/115/电影/A.mkv`）。依次尝试：

1. 填了「挂载目录」（如 `D:\CloudDrive`）：`挂载目录 + 路径` 落在某个库下；
2. 路径本身落在某个库下；
3. 库目录末尾几段 = 路径开头几段：库 `D:\CloudDrive\115\电影` 对上 `/115/电影/A (2001)/A.mkv` → `D:\CloudDrive\115\电影\A (2001)\A.mkv`。取对上段数最多的库；并列（两个库末尾同名且段数相同）视为对不上。

库目录就是整个挂载根目录（`D:\CloudDrive`）时第 3 步对不上，需要填挂载目录。对不上的条目计入 `ignored`，不会触发扫描。

对应上之后：取变化项的父目录（改名两头都要；变化项就是库根目录时扫根目录），每个库单独去抖——最后一条通知后静默 2 秒交出、持续有通知时最长 10 秒交一次，同目录合并，再按这些目录增量扫描。关了「监控文件夹」的库不收通知。

## 已知限制

- CloudDrive2 只通知经它发生的改动（挂载盘、它的网页、WebDAV、离线下载）；在网盘 App / 网站里直接改的文件没有通知，要手动扫描。
- 文件变更 webhook 是 CloudDrive2 会员功能。
- 端点只在桌面版；独立片库服务（网页端 / Docker）直接调 `POST /api/library/rpc` 的 `notifyChanges`，写法与容器里的路径映射见 [NAS 部署 · CloudDrive2](deploy/nas.md#clouddrive2-挂载的网盘)。
