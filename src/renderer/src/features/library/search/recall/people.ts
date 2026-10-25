/** 普通片库按演职员查询，私密片库同时召回演员资料（不跨来源取演员）。 */
import { libraryBridge } from '../../api/bridge'
import type { SearchRecall } from '../types'
export const recallPeople: SearchRecall = async request => {
  const api = libraryBridge()
  const name = request.text
    .replace(/(主演|导演|演的|拍的)\s*[：:]?/g, '')
    .replace(/^[\s：:]+|[\s：:]+$/g, '')
  if (!api || !name) return { kind: 'people', candidates: [] }
  const [page, actors] = await Promise.all([
    api.query({
      ...request.base,
      people: [...(request.base.people ?? []), name],
      limit: 20,
    }),
    request.scope === 'jav'
      ? api.actors.list({ search: name, limit: 8 }).catch(() => null)
      : null,
  ])
  return {
    kind: 'people',
    candidates: page.items.map(item => ({
      item,
      reason: `演职员匹配：${name}`,
    })),
    actors: actors?.items ?? [],
  }
}
