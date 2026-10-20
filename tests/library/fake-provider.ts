import type {
  Candidate,
  ExternalIdSource,
  MediaKind,
  MetadataProvider,
  SearchQuery,
} from '../../src/shared/library/provider'
import { normalizeTitle } from '../../src/shared/library/scoring'

/** 测试用条目：候选信息 + 可被反查的外部 ID。 */
export interface FakeEntry extends Candidate {
  externalIds?: Partial<Record<ExternalIdSource, string>>
}

/** 内存里的元数据源：标题包含查询词（归一化后）即命中，记录每次调用。 */
export class FakeProvider implements MetadataProvider {
  readonly name = 'tmdb' as const
  readonly calls: string[] = []

  constructor(private readonly entries: FakeEntry[]) {}

  async search(query: SearchQuery): Promise<Candidate[]> {
    this.calls.push(`search:${query.kind}:${query.title}:${query.year ?? ''}`)
    const q = normalizeTitle(query.title)
    return this.entries.filter(e => {
      if (e.ref.kind !== query.kind) return false
      if (query.year !== undefined && e.year !== query.year) return false
      const titles = [e.title, e.originalTitle, ...(e.alternativeTitles ?? [])]
      return titles.some(t => t && normalizeTitle(t).includes(q))
    })
  }

  async details(kind: MediaKind, id: string): Promise<Candidate | null> {
    this.calls.push(`details:${kind}:${id}`)
    return (
      this.entries.find(e => e.ref.kind === kind && e.ref.id === id) ?? null
    )
  }

  async find(source: ExternalIdSource, id: string): Promise<Candidate[]> {
    this.calls.push(`find:${source}:${id}`)
    return this.entries.filter(e => e.externalIds?.[source] === id)
  }
}
