# ADR-0020 片库服务承载 115 网盘、追更与库外发现

- 状态：已采纳（2026-10-26）
- 相关：ADR-0010（NAS / Docker 部署）、ADR-0011（网盘模式与外部变更通知）

## 背景

追更（剧集、洗版、电影上线追踪）、115 转存和库外发现原本只在桌面端主进程里跑：115 的登录 Cookie 放在 Electron 分区 `persist:pan115`，
请求靠分区补 Referer / UA 和公网守卫，状态与设置在 userData 和 safeStorage，定时器用主进程的 setTimeout。用户把片库服务放到 NAS 的 Docker 里，
希望 NAS 一直开着替他追更，网页端也能用这些板块，而不必让桌面版常开。

## 决策

- **模块宿主**：`src/main/pan115`、`autograb`（含 `movies`、`upgrade`）、`discover` 的入口只依赖 `src/main/module-host` 的 `ModuleHost`
  （数据目录、设置读取、TMDB 令牌、契约登记 / 事件推送、定时登记）。桌面端用 `module-host/desktop.ts`（ipcMain、settings.json、safeStorage、userData），
  行为与之前相同；服务端在 `src/server/netdisk` 组装。媒体库调用接口 `LibraryEngineClient` 挪到无 Electron 依赖的 `library/client.ts`。
- **115 传输层**：沿用 `Pan115Transport` 接口（`fetch` + `useCookie`），两个实现。桌面端仍是分区 `session-transport.ts`；服务端是
  `node-transport.ts`：Node fetch（undici）+ 持久化 Cookie 罐 `<数据目录>/pan115-cookies.json`（0600、原子替换）。只发 115 域请求，
  重定向手动跟且不出 115 域（代替桌面端分区上的公网守卫）；同一份登录 Cookie 再交来时不重写，保留 115 用 Set-Cookie 续上的值。
  会话（Cookie + 账号名）存 `secrets.json` 的 `pan115.session`，与桌面端 safeStorage 同名。
- **契约走 HTTP**：服务端的 `DomainRegistry` 接住 `implement` / `emit`；`POST /api/domains/<域>/<方法>`（参数经契约 parse，失败以数据返回）与
  `GET /api/domains/events`（SSE）。网页端 `services/server-domains` 造出与 `window.api.<域>` 同形的对象，各板块 `api.ts` 没有 preload 时用它，
  界面代码不变。扫码登录在网页端完成。
- **设置**：服务端模块要读的键（PanSou 地址、转存目标、挂载根）存在 `<数据目录>/server-settings.json`，白名单与校验和桌面端 schema 同源；
  网页端写这几个键时先写服务端。环境变量 `YINGBOX_PANSOU_URL`、`YINGBOX_MOUNT_ROOT` 可只读固定。
- **定时器单例**：服务端的 `schedule()` 同名只登记一次；每轮执行前要持有 `<数据目录>/scheduler.lock` 调度租约（独占创建、90 秒租期、每 30 秒续、
  过期可接管、退出时释放），共享同一数据目录的多个实例只有一个在跑。`YINGBOX_AUTOGRAB=off` 只提供接口不跑任务，`YINGBOX_NETDISK=off` 整体不加载。
- **入库**：转存后调同进程 `LibraryService.notifyChanges`，与桌面端经引擎调用的是同一个方法。

## 后果

- NAS 上的服务会定时向 115 / PanSou / TMDB 发请求（只在用户登录 115、开了追更之后）；限速、熔断仍是追更共用的闸门。
- 115 Cookie 在服务端落盘（桌面端只在内存与 safeStorage）：安全性等于数据目录的文件权限，文档要求只让服务用户可读。
- 桌面端与服务端是两份独立的追更状态；同一个 115 账号两边都开追更会各自转存，文档提示二选一。
- 入库推送（系统通知 / Bark / Telegram）仍只在桌面端。
- 租约基于文件与时间：持有者崩溃后最多 90 秒才被接管；两个实例同时判定过期时，接管方挪走旧文件后核对内容，挪到的是对方刚建的新租约就放回并让出，不会两边同时持有；刚建还没写完的空文件按修改时间算租期。

## 否决方案

- **服务端用 Electron（无头）跑这些模块**：镜像变大、arm64 NAS 上不现实，违背 ADR-0010 的「镜像里只有 Node」。
- **服务端也手写 Cookie 头、不落盘**：容器每次重启都要重新扫码；115 用 Set-Cookie 续期的值也会丢。
- **把设置整份搬到服务端**：网页端其余设置（外观、播放器）本来就是每个浏览器各自的，只有服务端模块要读的几个键需要统一。
- **用数据库行锁 / 进程 pid 判单例**：多个容器共享网络卷时 pid 没有意义；租约文件跨主机也成立。
