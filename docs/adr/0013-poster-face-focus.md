# ADR-0013 海报人脸取景：启发式焦点 + FaceDetector 细化，用 object-position 不重编码

- 状态：已采纳（2026-10-22）
- 相关：PR #83（feat/face-crop）

## 背景

部分条目只有横版封套（背面 | 书脊 | 正面 拼成的横图），也有只有剧照的条目；海报墙和竖版海报卡用 `object-fit: cover` 居中裁，常切掉人脸、露出书脊。参考 Peach：它在服务端找书脊折痕、用 YuNet（OpenCV DNN + ONNX 模型）检人脸，把坐标存进 sidecar，页面按坐标取景。

## 决策

- 焦点是归一化坐标（`src/shared/media-focus.ts`），由缩略图管线在编解码线程里算（`src/main/thumbnails/focus/`，纯 TS、零依赖）：封套比例（1.2–1.65）时在「切出正面宽高比 0.64–0.8」的列里找整高竖直强边当书脊，框出正面；再找肤色（Kovac RGB 规则）连通块里最大、最靠上的人取头部重心；没人取边缘能量重心；平坦取正中。
- 存 `<mediaDir>/thumb/<前两位>/<key>.focus.json`，与缩略图同一个 LRU；生成缩略图时只给宽高比 ≥ 0.75 的图顺手算，其余问到时解码已有缩略图现算，一次一张。
- 界面只写 `object-position`（窗口尽量不出正面框），不重新编码图片；桌面经 IPC `media` 域，网页经片库服务 `POST /media/focus`。
- 主进程开 `--enable-blink-features=FaceDetector`（不开整个 experimental-web-platform-features）：Windows / macOS 有系统实现，渲染层在后台逐张用人脸细化并写回（`by: 'face'`，不随算法版本作废）；Linux 上 `detect` 报 NotSupportedError，之后不再尝试。

## 后果

- 不加任何依赖，NAS / Docker（没有 Chromium）也有启发式焦点；Windows / macOS 额外有系统人脸检测。
- 启发式会错：灰度 / 偏色图肤色规则失效（退到边缘重心）；身体比脸大时取的是「最大肤色块的头部」，多人时取最大的那个人。
- 没检出折痕不框正面（3:2 剧照也在封套比例里），这时背面的脸可能被选中；16:9 拼图正中的正封（Peach 的 center 版式）没做。

## 否决方案

- ONNX 小模型（YuNet / UltraFace）+ onnxruntime：效果最好，但要原生依赖或几 MB wasm、模型分发与校验，桌面和 NAS 两套运行时；留作启发式不够时的下一步。
- 裁出竖版海报图另存：多一份图、改焦点就要重编码，手动调整也更贵。
- 只按比例假设正面在右：普通 3:2 剧照会被裁错。
