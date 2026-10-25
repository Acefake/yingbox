# 按画面搜

用一句话描述画面（如「海边日落」），在封面、剧照和视频画面里找片。标签缺失或各站叫法不一时也能找到；
命中视频画面时显示那一帧和时间点，点一下从那里播放。

## 原理

- 模型：OFA-Sys 中文 CLIP（chinese-clip-vit-base-patch16，Xenova 转换的 ONNX 量化版，约 190 MB），图文映射到同一个 512 维空间。
- 运行时：onnxruntime-node（原生模块，CPU，线程数为一半核数）。onnxruntime-web 在 Node 里实测慢约 6 倍，不用。
  加载失败（不支持的平台）只是这个功能不可用。
- 分词：自写 BERT WordPiece（`src/main/library/visual/clip-tokenizer.ts`），与 transformers.js 输出一致；不引 transformers.js（会带上 sharp）。
- 像素：编解码线程里 wasm 解码，拉伸到 224×224（codec 的 `clip` 任务）。
- 存储：`visual_vectors`（每张图 4 字节缩放系数 + 512 维 int8）、`visual_items`（按图片地址签名判断要不要重建），迁移 V7。
  V11 给 `visual_vectors` 加帧来源 `source`（`image` / `frame`）、`file_id`、`at_ms`，另建 `visual_frames` 记每个视频的抽帧进度。
- 检索：内存里全量点积。封面、剧照、视频帧按条目合并，每部取最像的一个画面排序；抽过帧的片另带最像的 3 个时间点
  （`visual-rank.ts`）。

## 视频关键帧

面板里「视频画面」开关（默认关）。打开后后台从本地视频抽帧，和封面剧照进同一张向量表。

- 抽帧计划：每 30 秒一帧，从第 15 秒起；超过 60 帧的长片整片均匀取 60 帧；不到 30 秒取中点一帧。
  时长先用库里探测过的，没有就读文件头，再不行问 `ffmpeg -i`。
- 取帧：每个时间点起一次 ffmpeg（输入端 `-ss` 跳到关键帧再精确解码，单线程，子进程调低优先级），
  一次解码分两路：224×224 RGBA 走标准输出直接编码（与图片同样拉伸），宽 240 的小 JPEG 进图片缓存 `orig/`
  （地址 `yingbox-media://image/<key>`，桌面端和网页端都按已有规则显示）。不存大图。
- 去重：按时间顺序，和上一张保留的帧余弦相似度 ≥ 0.92 就丢掉（镜头不动的连续帧）。续跑时和上一批最后保留的帧比。
- 调度：任务 `visual-frames`，优先级 -30，排在识别后补图片索引（-20）之后；补图片索引跑完会接着排它。
  每批 8 帧开工前查队列，有别的任务在跑或待跑就停下，一分钟后再排。
- 暂停 / 关掉：取消正在跑的任务（ffmpeg 一起结束）；已入库的批次保留。
- 断点续跑：每批入库时记下计划里处理到第几帧（`visual_frames.next_index`），引擎重启或继续时从那里接着抽。
  文件大小 / 修改时间、模型、抽帧规则版本任一变了就整份重抽，旧帧和缩略图删掉。读不到时长的文件记为出错，文件不变不再试。
- 网盘：按网盘处理的库默认跳过（要读整部视频的多个位置），面板里可打开；远程源（WebDAV / Alist）没有本地路径，始终跳过。
- ffmpeg：桌面端向主进程要路径（与 ffprobe 同一套查找，`tools-host.ts`）；独立服务用 `YINGBOX_FFMPEG`，否则 PATH 上的 `ffmpeg`。
  找不到时任务失败，面板显示原因。
- 播放：点视频画面 → 取条目详情，定位到那个文件，`startAt` 为该时间点（分段电影照常连播）。

## 流程

1. 媒体库工具栏「按画面」→ 面板；第一次点「下载模型并建立索引」。
2. `visual-index` 任务：缺模型先下载（huggingface.co，失败换 hf-mirror.com）→ 逐部取封面和最多 24 张剧照（原图缓存里没有的顺便下载）→ 编码入库。
3. 之后识别出新片，识别后继自动排低优先级的补索引任务（用户启用过才排）。

## 文件

- 引擎：`src/main/library/visual/`（clip-encoder、clip-tokenizer、clip-model-files、clip-backend、clip-pixels、visual-rules、visual-rank、visual-store、visual-module、visual-setup），`db/schema-visual.ts`
- 视频关键帧：`src/main/library/visual/frames/`（frame-rules 计划 / 去重 / 签名、frame-ffmpeg 取帧、frame-store、frame-indexer 任务）
- 契约：`src/shared/library/ipc/contract-visual.ts`、`validate-visual.ts`
- 前端：`src/renderer/src/features/library/visual/`（VisualSearch、VisualHitCard、FramesSettings、play-moment）
- 打包：`electron-builder.yml` 解包 `onnxruntime-node/bin` 并按平台裁剪；Dockerfile 只留 Linux 二进制。

## 测试

- `tests/library/visual/frame-rules.test.ts`：抽帧计划、相近帧去重、签名、设置与参数解析、ffmpeg 时长与取帧参数
- `tests/library/visual/visual-rank.test.ts`：图片与视频帧合并排序、时间点
- `tests/library/visual/visual-frames.test.ts`：真实服务 + 假取帧：抽帧入库、搜索、图片重建不动帧、暂停续跑、让出、网盘跳过、文件变了重抽、V11 迁移
- `tests/library/visual/frame-ffmpeg.test.ts`：真 ffmpeg 取帧（没有 ffmpeg 时跳过）

## 以后

- 场景切换检测（`select='gt(scene,…)'`）代替固定间隔：要解整部视频，先看固定间隔 + 去重够不够用。
- HDR 视频的帧没做色调映射，缩略图偏灰，编码也会受影响。
- 条目整部删掉时，帧缩略图文件留在 `orig/`（向量随条目级联删掉）；以后和图片缓存一起做清理。
- 去重阈值 0.92 只在合成数据上验证过，要拿真片调。
- 更大的模型（large-patch14）提高准确度，代价是 3 倍算力。
