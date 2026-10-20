# 媒体库界面截图与滚动性能驾驭

不进应用构建、不进 CI，开发机上手动跑。用网页版构建 + 注入假的 `window.api.library`（5 万部电影、2000 部剧集），
在 Playwright Chromium 里截图并测海报墙滚动帧率。

```bash
pnpm build:web                                   # 产物在 dist-web/
(cd dist-web && python3 -m http.server 4179 --bind 127.0.0.1 &)
mkdir -p /tmp/ui-harness && cd /tmp/ui-harness && npm i playwright && npx playwright install chromium
cp <repo>/scripts/ui-harness/* . && mkdir img && (cd img && python3 ../gen-images.py)   # 需要 ImageMagick
OUT=<repo>/docs/library-refactor/screenshots node shoot.mjs   # 亮 / 暗主题截图
SPEED=60 node perf.mjs                                         # 每帧滚 60px；SPEED=240 模拟快速甩动；ABL=1 做消融
```

- `mock-library.js`：假引擎，query 在内存里做筛选 / 排序 / 搜索 / 分页，每次调用延迟 4ms 模拟 IPC。
- 图片：浏览器里没有 `yingbox-media://` 协议，假数据用 TMDB 形式的地址，由 Playwright 路由到本地生成的图。
- Linux 依赖：`libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libatspi2.0-0 fonts-noto-cjk`。
- 不要给 Chromium 加 `--enable-gpu-rasterization`：在没有 GPU 的机器上它让软件光栅化变慢，帧率会掉到 36，测的是参数而不是界面。
