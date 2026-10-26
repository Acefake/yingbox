/**
 * v12：评分来源（见 shared/library/rating.ts）。NULL 表示不知道。
 *
 * 老数据能推断的推断：评分与 metadata JSON 里 TMDB 给的评分相同（顶层条目 ref.provider = tmdb，
 * 或集：集只来自 TMDB）就是 tmdb；其余（NFO 补的、来源不明的）留 NULL，界面只显示分数。
 */
export const V12_SCHEMA = `
ALTER TABLE media_items ADD COLUMN rating_source TEXT
  CHECK (rating_source IN ('douban', 'tmdb', 'imdb', 'nfo'));
UPDATE media_items SET rating_source = 'tmdb'
WHERE rating IS NOT NULL AND CASE WHEN json_valid(metadata) THEN
  (json_extract(metadata, '$.ref.provider') = 'tmdb'
    OR json_extract(metadata, '$.level') = 'episode')
  AND abs(json_extract(metadata, '$.rating') - rating) < 1e-6
  ELSE 0 END;
`
