/**
 * 合并展示（见 shared/library/ipc/contract-merge.ts）：同一作品的多个本地条目在展示层合成一个。
 *
 * - merge_split：用户手动拆分时记下当时的元数据源 id；只要条目还匹配着这个 id 就不参与合并，
 *   改匹配到别的 id 后自动失效（不用另外清）；
 * - merge_key：虚拟生成列，顶层条目已确认匹配（auto / locked）且没被拆出时为「类型:id」，否则 NULL。
 *   键相同的条目是同一作品；海报墙按它去重，详情按它找版本。随 tmdb_id / match_state / merge_split
 *   自动变化，没有任何写入路径需要维护它；
 * - 部分索引只收有键的行：去重是「有没有 id 更小的同键条目」的索引探测，未识别的条目不占索引。
 */
export const MERGE_SCHEMA = `
ALTER TABLE media_items ADD COLUMN merge_split TEXT;
ALTER TABLE media_items ADD COLUMN merge_key TEXT GENERATED ALWAYS AS (
  CASE WHEN parent_id IS NULL AND tmdb_id IS NOT NULL
    AND match_state IN ('auto', 'locked')
    AND (merge_split IS NULL OR merge_split <> tmdb_id)
  THEN type || ':' || tmdb_id END
) VIRTUAL;
CREATE INDEX media_items_merge ON media_items (merge_key, id)
  WHERE merge_key IS NOT NULL;
`
