# WebDAV / Alist 媒体库源

媒体库文件夹可以在 NAS 或 Alist 上，经 WebDAV 访问，不用先挂载成本地盘。

## 怎么用

媒体库设置 →「WebDAV / Alist」：

1. 「添加源…」：名称、地址、用户名、密码，可先「测试连接」。
   - Alist：`http://<地址>:5244/dav`（Alist 后台开启 WebDAV，用户要有 WebDAV 读权限）；
   - 群晖 / 威联通 WebDAV Server：`http(s)://<地址>:5005` / `:5006`（或套件里配的端口与路径）；
   - rclone serve webdav、nginx / Apache 的 WebDAV 同理。
2. 「添加 WebDAV 文件夹…」：选源，逐级进入要加的文件夹，添加后立即扫描、按库设置自动识别。
3. NAS 上加了片子后点该文件夹的「扫描」。远程源不监听变化、不定时扫描。

## 行为

| 方面        | 远程库                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径        | 库里登记为 `yingbox-dav://<源 id>/<远程路径>`（原文，带中文与空格）                                                                                                               |
| 扫描        | PROPFIND Depth: 1 逐层列目录，并发 4、单次 20 秒超时；目录 etag / getlastmodified 没变就不列（版本戳规则见 `scanner/remote-rules.ts`）；全量扫描无视版本戳                        |
| 掉线        | 根目录列不到时整次扫描失败，不会把库当成「全删了」；子目录失败只告警、保留旧记录                                                                                                  |
| 存储        | 一律按网盘处理（ADR-0011）：不 fs.watch、不定时扫描、不算指纹、悬停预览只用已缓存图片                                                                                             |
| 识别        | 只靠文件名与目录名；不读视频内容（时长、OpenSubtitles 哈希）、不读旁边的 NFO                                                                                                      |
| 写出 / 整理 | 禁用：手动写出跳过远程条目、整理直接拒绝、不给自动写出 / 整理后继                                                                                                                 |
| 播放        | 内置播放器加载 `yingbox-dav://…`，主进程协议处理器带凭据转发（支持 Range）；mpv 拿到本机代理 `http://127.0.0.1:<随机端口>/<随机令牌>/…`，只听回环地址                             |
| 凭据        | `userData/webdav-sources.json`：地址、用户名明文，密码经 safeStorage 加密；只在主进程和媒体库引擎（扫描前经线协议 host 代办 `webdavAccess` 取）里出现，渲染层只知道「有没有密码」 |

## 代码

- `src/shared/webdav/`：路径约定（`remote-path.ts`）、PROPFIND 请求体与 207 解析（`propfind.ts`）、最小客户端（`client.ts`）、播放代理转发规则（`proxy-rules.ts`）
- `src/main/library/scanner/remote-walk.ts`：远程遍历，产出与本地遍历相同的差异；`diff-dir.ts` 两者共用
- `src/main/library/remote/host-remote.ts`：引擎侧向主进程要凭据
- `src/main/webdav/`：源存储、`webdav` 契约域、`yingbox-dav` 协议与 mpv 代理
- `src/renderer/src/features/library/webdav/`：设置分组、源表单、远程文件夹选择
- 测试：`tests/webdav-source.test.ts`

## 限制

- 独立片库服务（`src/server`，网页端）没有远程源：源与凭据在桌面端主进程里。
- 远程视频没有外挂字幕自动挂载（字幕查找只认 `local://`）。
- 部分网盘挂到 Alist 后目录没有修改时间：这些目录每次扫描都会重新列（版本戳记为不可信）。
