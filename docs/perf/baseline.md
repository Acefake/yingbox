# 性能基线（阶段 0）

整体重构每个阶段都和这里对比，阶段 5 结束时写 `docs/perf/after.md`。

- 基线版本：`main @ ac92d77`（PR #10 合入后），以及本 PR 删依赖之后。
- 测量环境：Linux 沙箱，Node 22.23，pnpm 12.14，`pnpm install --ignore-scripts`。
- 静态指标可重跑：`pnpm build:nocheck && pnpm perf:static`（脚本 `scripts/measure-static.mjs`）。

## 一、能在沙箱里测的（已测）

### 依赖

| 指标 | main @ ac92d77 | 本 PR 之后 |
|---|---|---|
| package.json `dependencies` | 13 | 11 |
| 解析后的生产依赖（含传递，去重） | 203 | 189 |
| 解析后的全部依赖（含 dev，去重） | 745 | 731 |

删掉的是 `pinia`（零 store、未 `app.use`）和 `@types/crypto-js`（类型包却放在 dependencies，且没有任何 TS 引用）。

`cheerio`、`crypto-js` **没有删**：方案里说它们无人引用，但 `packages/backend/py/catspider_runner.js` 在运行时 `require` 了这两个包（CatSpider 插件沙箱向插件暴露 `cheerio` 和 `CryptoJS`），Go 后端通过 `NODE_PATH=<项目根>/node_modules` 让它找到。删了会让所有 CatSpider 插件源失效。等阶段 3 把 CatSpider runner 收进 Engine 时再决定去留。

### 构建产物（`out/`，`electron-vite build`）

删依赖前后一致（pinia 本来就没打进包），所以只列一份：

| 进程 | 文件数 | 原始 | gzip |
|---|---|---|---|
| main | 1 | 143.7 KB | 38.4 KB |
| preload | 1 | 10.5 KB | 2.9 KB |
| renderer（js/css/html） | 26 | 5764.2 KB | 1213.5 KB |

### renderer chunk（前 10）

| chunk | 内容 | 原始 | gzip |
|---|---|---|---|
| `index-*.js` | 入口（含 antd、artplayer 以外的全部同步依赖） | 3743.8 KB | 782.3 KB |
| `UnifiedVideoPlayer-*.js` | 播放器（artplayer + hls.js） | 1317.0 KB | 279.2 KB |
| `Index-*.js` | Amane 页 | 150.0 KB | 29.6 KB |
| `index-*.css` | 全局样式 | 121.8 KB | 22.3 KB |
| `ScrapeWorkbenchModal-*.js` | 刮削工作台 | 75.1 KB | 16.7 KB |
| `Index-*.js` | 在线详情页 | 73.9 KB | 16.7 KB |
| `Index-*.js` | AV 页 | 61.4 KB | 14.0 KB |
| `index-*.js` | 电影页 | 56.5 KB | 13.0 KB |
| `index-*.js` | 剧集页 | 54.5 KB | 12.1 KB |
| `Index-*.css` | Amane 页样式 | 39.1 KB | 7.8 KB |

入口 chunk 3.7 MB 是首屏最大的成本，主要是 ant-design-vue 全量注册（`app.use(Antd)`）。UI 项目收尾删 antd 后应明显下降。

### 单文件行数（前 10）

| 行数 | 文件 |
|---|---|
| 1714 | src/renderer/src/views/Amane/Index.vue |
| 1631 | src/renderer/src/views/av/Index.vue |
| 1408 | src/renderer/src/views/TV/composables/use-tv-scraping.ts |
| 1272 | src/renderer/src/views/online/DetailWindow.vue |
| 977 | src/renderer/src/views/TV/composables/use-tv-file-management.ts |
| 841 | src/renderer/src/components/UnifiedVideoPlayer.vue |
| 839 | src/renderer/src/components/Layout/AppLayout.vue |
| 737 | src/renderer/src/views/Amane/AgentPanel.vue |
| 718 | src/renderer/src/components/ScrapeQueuePanel.vue |
| 690 | src/renderer/src/views/Movie/composables/use-file-management.ts |

超过 400 行的文件共 26 个，完整清单见 `pnpm check:size`。

## 二、需要在用户机器上测的（未测，不填数字）

沙箱里没有显示器、GPU 和 Windows，下面这些数字只能在实机上测。每项给出测量方法，测完填进本表。

| 指标 | 数值 | 测量方法 |
|---|---|---|
| 冷启动到首屏 | 待测 | 见 1 |
| 主进程长任务 | 待测 | 见 2 |
| 空闲内存（全部进程） | 待测 | 见 3 |
| 1 万项海报墙滚动帧率 | 待测 | 见 4 |
| 安装包体积 | 待测 | 见 5 |

1. **冷启动到首屏**：重启电脑或关掉所有影盒进程后，运行 `pnpm build:unpack`，再以 `dist/win-unpacked/影盒.exe --remote-debugging-port=9222` 启动。用 Chrome 打开 `chrome://inspect` 连上主窗口，在 Console 执行 `performance.getEntriesByType('paint')`，取 `first-contentful-paint`；进程启动时刻用 PowerShell `(Get-Process 影盒 | Sort StartTime | Select -First 1).StartTime` 取得。两者相减即冷启动时间。连测 5 次取中位数，第一次（磁盘冷缓存）单独记录。
2. **主进程长任务**：以 `--inspect=9229` 启动应用，在 `chrome://inspect` 打开 Node 调试器的 Performance 面板录 30 秒：启动、打开电影库、触发一次扫描、打开播放器。记录超过 50 ms 的任务数量和最长一次时长。
3. **空闲内存**：启动后停在首页 2 分钟不操作，打开任务管理器「详细信息」页，把所有 `影盒.exe`、`main.exe`（Go 后端）、`python`、`node` 子进程的「内存（专用工作集）」相加。
4. **1 万项滚动帧率**：准备一个含 1 万个视频文件的目录（可用空文件 + 正确扩展名生成），加入电影库。DevTools → Performance 勾选 Screenshots，录制匀速滚动海报墙 10 秒，记录 FPS 曲线的中位数和最低值，以及最长的一帧耗时。
5. **安装包体积**：`pnpm build:win:full` 后看 `dist/` 下 NSIS 安装包的字节数，另记 `dist/win-unpacked/` 目录总大小，以及其中 `resources/backend`、`resources/mpv`、`resources/amane` 各自的大小。
