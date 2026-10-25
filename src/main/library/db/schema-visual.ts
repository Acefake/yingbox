/**
 * V7：按画面搜的图片向量（中文 CLIP，见 library/visual）。
 *
 * - visual_vectors：每张图（封面 / 剧照，按远程地址区分）一条向量：4 字节 float32 缩放系数 + 512 维 int8，约 0.5 KB；
 * - visual_items：条目的索引状态。signature 是参与索引的图片地址的摘要：重新识别后图片变了就重建，
 *   model 换了也重建。条目删除时两张表级联清掉。
 */
export const V7_SCHEMA = `
CREATE TABLE visual_vectors (
  item_id INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  image   TEXT    NOT NULL,
  vec     BLOB    NOT NULL,
  PRIMARY KEY (item_id, image)
) STRICT, WITHOUT ROWID;

CREATE TABLE visual_items (
  item_id    INTEGER PRIMARY KEY REFERENCES media_items (id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,
  signature  TEXT    NOT NULL,
  images     INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
) STRICT;
`

/**
 * V9：视频关键帧（见 library/visual/frames）。
 *
 * - visual_vectors 加帧来源：source = 'image'（封面 / 剧照，image 是远程地址）或 'frame'
 *   （视频帧，image 是帧缩略图的 yingbox-media 地址，file_id / at_ms 是它在哪个文件的第几毫秒）；
 *   图片索引重建只替换 source = 'image' 的行，帧在文件删除时级联清掉。
 * - visual_frames：每个视频文件的抽帧进度。signature 是模型 + 文件大小 / 修改时间 + 抽帧规则的摘要，
 *   变了就整份重抽；next_index 是计划里已处理到第几帧（断点续跑从这里接着抽）。
 */
export const V9_SCHEMA = `
ALTER TABLE visual_vectors ADD COLUMN source TEXT NOT NULL DEFAULT 'image'
  CHECK (source IN ('image', 'frame'));
ALTER TABLE visual_vectors ADD COLUMN file_id INTEGER
  REFERENCES files (id) ON DELETE CASCADE;
ALTER TABLE visual_vectors ADD COLUMN at_ms INTEGER;
CREATE INDEX visual_vectors_file ON visual_vectors (file_id, at_ms)
  WHERE file_id IS NOT NULL;

CREATE TABLE visual_frames (
  file_id    INTEGER PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  model      TEXT    NOT NULL,
  signature  TEXT    NOT NULL,
  planned    INTEGER NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  state      TEXT    NOT NULL CHECK (state IN ('running', 'done', 'error')),
  error      TEXT,
  updated_at INTEGER NOT NULL
) STRICT;
`
