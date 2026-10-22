# 按画面搜（番号库）

用一句话描述画面（如「高跟鞋」），在封面和剧照里找片。标签缺失或各站叫法不一时也能找到。

## 原理

- 模型：OFA-Sys 中文 CLIP（chinese-clip-vit-base-patch16，Xenova 转换的 ONNX 量化版，约 190 MB），图文映射到同一个 512 维空间。
- 运行时：onnxruntime-node（原生模块，CPU，线程数为一半核数）。onnxruntime-web 在 Node 里实测慢约 6 倍，不用。
  加载失败（不支持的平台）只是这个功能不可用。
- 分词：自写 BERT WordPiece（`src/main/library/visual/clip-tokenizer.ts`），与 transformers.js 输出一致；不引 transformers.js（会带上 sharp）。
- 像素：编解码线程里 wasm 解码，拉伸到 224×224（codec 的 `clip` 任务）。
- 存储：`visual_vectors`（每张图 4 字节缩放系数 + 512 维 int8）、`visual_items`（按图片地址签名判断要不要重建），迁移 V7。
- 检索：内存里全量点积，每部取最像的一张图排序。

## 流程

1. 番号页工具栏「按画面」→ 面板；第一次点「下载模型并建立索引」。
2. `visual-index` 任务：缺模型先下载（huggingface.co，失败换 hf-mirror.com）→ 逐部取封面和最多 24 张剧照（原图缓存里没有的顺便下载）→ 编码入库。
3. 之后识别出新片，识别后继自动排低优先级的补索引任务（用户启用过才排）。

## 文件

- 引擎：`src/main/library/visual/`（clip-encoder、clip-tokenizer、clip-model-files、clip-backend、clip-pixels、visual-rules、visual-store、visual-module、visual-setup），`db/schema-visual.ts`
- 契约：`src/shared/library/ipc/contract-visual.ts`、`validate-visual.ts`
- 前端：`src/renderer/src/features/library/visual/`
- 打包：`electron-builder.yml` 解包 `onnxruntime-node/bin` 并按平台裁剪；Dockerfile 只留 Linux 二进制。

## 以后

- 视频关键帧（需要 ffmpeg）：剧照拍不到的片段也能搜，还能定位到时间点。
- 更大的模型（large-patch14）提高准确度，代价是 3 倍算力。
