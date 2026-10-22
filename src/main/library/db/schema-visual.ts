/**
 * V7：按画面搜的图片向量（中文 CLIP，见 library/visual）。
 *
 * - visual_vectors：每张图（封面 / 剧照，按远程地址区分）一条 512 维 int8 向量（归一化后 ×127），约 0.5 KB；
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
