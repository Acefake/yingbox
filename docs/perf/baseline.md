# 性能基线与重构前后对比

第一部分是阶段 0 的基线（main @ ac92d77）；第三部分是阶段 5 结束时（整条重构链 p0→p5）与当前 main 的对比。

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

## 二、需要在用户机器上测的（阶段 0 时未测，不填数字）

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

## 三、阶段 5：整条重构链（p0 → p5）前后对比

- 前：`main @ 5fe2b7f`（已含影视库引擎 #15，重构链的起点）。
- 后：`refactor/p5-perf`（叠在 #12 → #13 → #16 → #18 → #19 → #21 → #22 → #23 → #25 → #27 → #28 → #30 → #29 之上）。
- 环境：同上（Linux 沙箱，Node 22，pnpm 12.14，`--ignore-scripts`）。两边都用同一份 `scripts/measure-static.mjs` 测；main 上没有这个脚本，临时拷过去跑的。
- 重跑：两个分支分别 `pnpm build:nocheck && pnpm perf:static`。

### 依赖

| 指标 | main @ 5fe2b7f | p5 | 变化 |
|---|---|---|---|
| package.json `dependencies` | 14 | 11 | −3（pinia、axios、@types/crypto-js） |
| 解析后的生产依赖（含传递，去重） | 204 | 170 | −34 |
| 解析后的全部依赖（含 dev，去重） | 774 | 751 | −23 |

阶段 5 没有加依赖：虚拟列表（`UiVirtualGrid`，约 200 行）是自写；缩略图后来与媒体库合成一套（主进程 nativeImage + `@jsquash/webp`，见 opt/a）。

### 构建产物（`out/`）

| 进程 | main @ 5fe2b7f | p5 | 说明 |
|---|---|---|---|
| main（全部文件） | 3 个 · 239.2 KB / gzip 68.5 KB | 5 个 · 317.3 KB / gzip 94.2 KB | 见下表 |
| preload | 12.1 KB / gzip 3.5 KB | 19.1 KB / gzip 7.2 KB | 按单一契约表生成 `window.api`，契约文件（含参数解析器）一起打进 preload；仍只 `require("electron")` |
| renderer（js/css/html） | 26 个 · 5764.4 KB / gzip 1213.5 KB | 61 个 · 5736.4 KB / gzip 1225.6 KB | 拆包更细；总量基本持平 |

main 进程拆开看：

| 文件 | main @ 5fe2b7f | p5 |
|---|---|---|
| `index.js`（主进程） | 146.4 KB / gzip 39.1 KB | 172.6 KB / gzip 48.0 KB |
| `engine.js`（引擎 utilityProcess，新增） | — | 41.1 KB / gzip 12.5 KB |
| `chunks/online-*.js`（引擎在线域，新增） | — | 10.8 KB / gzip 4.2 KB |
| `library-engine.js`（影视库引擎，未动） | 87.2 KB / gzip 26.5 KB | 87.2 KB / gzip 26.5 KB |

main 进程 JS 变大是预期的：原来 Go 后端（2198 行 Go）+ Python 下载器（1509 行）+ CatSpider runner（565 行 JS）在 JS 包之外，现在由引擎和插件宿主承担，换来的是安装包里不再带 Go 可执行文件与 Python 运行时（体积差见实机项 5）。

### renderer chunk（前 10）

| main @ 5fe2b7f | 原始 / gzip | p5 | 原始 / gzip |
|---|---|---|---|
| `index`（入口） | 3743.8 / 782.3 KB | `index`（入口） | 3543.3 / 738.1 KB |
| `UnifiedVideoPlayer` | 1317.0 / 279.2 KB | `UnifiedVideoPlayer` | 1318.8 / 279.9 KB |
| `Index`（Amane 页） | 150.0 / 29.6 KB | `AmaneView` | 165.1 / 34.8 KB |
| `index.css` | 121.7 / 22.3 KB | `OnlineView` | 76.5 / 17.5 KB |
| `ScrapeWorkbenchModal` | 75.2 / 16.7 KB | `ScrapeWorkbenchModal`（影视，未动） | 75.3 / 16.7 KB |
| `Index`（在线详情） | 73.7 / 16.7 KB | `index.css` | 74.0 / 14.5 KB |
| `Index`（AV 页） | 61.4 / 14.0 KB | `AmaneSettingsSection` | 68.9 / 16.4 KB |
| `index`（电影页） | 56.5 / 13.0 KB | `AvView` | 64.5 / 16.4 KB |
| `index`（剧集页） | 54.5 / 12.1 KB | `index`（电影页） | 56.7 / 13.0 KB |
| `Index.css`（Amane） | 39.1 / 7.8 KB | `index`（剧集页） | 54.7 / 12.2 KB |

- 入口 chunk −200 KB（gzip −44 KB）：可以确认的来源是去掉 axios，以及 Amane 设置分区等拆成了异步块（`AmaneSettingsSection` 68.9 KB 现在单独成块）；没有逐模块做 bundle 分析。ant-design-vue 仍在入口里（迁移条件不满足，见 #28），是剩下最大的一块。
- 全局 `index.css` −48 KB：阶段 4 拆分时 feature 样式改成跟着组件走（scoped / 异步块），没有逐条核对。
- Amane 页 +15 KB：拆成 30 多个子组件 / 组合函数后多了模块包装与 scoped 样式哈希，属于拆分成本。
- 新增 `thumb.worker-*.js` 2.2 KB（缩略图 Worker，按需加载）。

### 代码规模与质量门槛

| 指标 | main @ 5fe2b7f | p5 |
|---|---|---|
| 最大单文件（行） | 1714（Amane/Index.vue） | 1408（影视 use-tv-scraping.ts，受保护） |
| 最大非影视文件（行） | 1714 | 394（online/SourceManagerPanel.vue） |
| 超过 400 行的文件 | 26 | 9（全是影视受保护文件，`check:size --strict` 豁免且只许变短） |
| src/ 下 ts/vue/mjs 总行数 | 41,550 | 49,269 |
| 测试 | 24 个文件 · 170 个用例 | 50 个文件 · 473 个用例 |
| 删除的 Go / Python / runner 代码 | — | `packages/backend` 整个删除：30 个文件 4,623 行（Go 2,198、Python 1,509、CatSpider runner JS 565，其余为 go.mod/go.sum/配置/许可） |
| lint | — | 0 error；`pnpm lint` 含 `check:size --strict`，CI（`.github/workflows/ci.yml`）跑全套 |

src/ 总行数增加约 7.7k：Go/Python 的 4.3k 行迁成 TypeScript 引擎（带类型、参数校验与测试替身注入），加上契约层、设置注册表、插件宿主和阶段 5 的虚拟列表 / 缩略图。删掉的是重复实现与跨语言胶水，新增的大多是可测的纯函数与类型。

## 四、阶段 5 需要在实机上测的（未测，不填数字）

| 指标 | main @ 5fe2b7f | p5 | 测量方法 |
|---|---|---|---|
| 冷启动到首屏 | 待测 | 待测 | 见第二部分 1 |
| 空闲内存（全部进程） | 待测 | 待测 | 见第二部分 3；p5 没有 Go / Python 进程，引擎与插件按需启动，空闲时只有 Electron 自身进程 |
| 安装包体积 | 待测 | 待测 | 见第二部分 5；p5 的 `resources/` 下应已没有 `backend` |
| AV 分类浏览滚动 1000 条的 DOM 节点数 | 待测 | 待测 | 见 6 |
| AV / 在线长列表滚动帧率 | 待测 | 待测 | 见 7 |
| 海报首屏解码耗时与缩略图命中 | 待测 | 待测 | 见 8 |
| 缩略图缓存目录大小 | — | 待测 | 见 9 |

6. **DOM 节点数**：打开 AV「分类浏览」，一直滚到底直到「已加载」≥ 1000 条。DevTools Console 执行 `document.querySelectorAll('.ui-poster').length`。main 上应等于已加载条数；p5 上应只有视口附近几行（与条数无关，通常 < 60）。在线搜索、Amane 影片墙、下载队列同法。
7. **滚动帧率**：同一页面加载到 1000 条后，DevTools → Performance 勾选 Screenshots，录制匀速滚动 10 秒，记录 FPS 中位数、最低值和最长一帧。也可在 Rendering 面板打开「Frame Rendering Stats」看实时帧率。
8. **海报解码**：清空 `userData/library/media/thumb` 后打开 AV 浏览，Performance 面板录首屏加载，统计 `Decode Image` 事件的总耗时；关掉应用再打开同一页面重录一次（这次应命中 WebP 缓存）。Network 面板筛 `yingbox-media:` 可看每张图的大小（都应是 WebP）。
9. **缓存大小**：浏览几个分类后看 `%APPDATA%/影盒/library/media/thumb`（mac：`~/Library/Application Support/影盒/library/media/thumb`）的文件数与总大小（打包版目录名是 productName「影盒」，开发模式是 `yingbox`）；上限 512 MB，超出后应回落到约 460 MB。
