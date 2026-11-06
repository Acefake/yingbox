/** 媒体库条目查询与元数据操作，由服务宿主提供模块依赖。 */
import type {
  ApplyMatchRequest,
  ApplyMatchResult,
  FacetListRequest,
  FacetValue,
  IdentifyRequest,
  JobAccepted,
  LibraryItemNode,
  LibraryItemSummary,
  LibraryQueryResult,
  MatchCandidatesResult,
  NormalizedLibraryQuery,
  ProviderStatus,
  RefreshMetadataRequest,
  SetProviderTokenRequest,
} from '../../../shared/library/ipc'
import { LibraryError } from '../../../shared/library/ipc'
import type { CatalogQuery } from '../catalog/query'
import type { IdentifyModule } from '../identify/identify-module'
import type { LibraryStore } from '../libraries/library-store'

export abstract class CatalogCommands {
  protected abstract readonly catalogQuery: CatalogQuery
  protected abstract readonly libraries: LibraryStore
  abstract readonly identifier: IdentifyModule
  protected readonly matching = new Set<number>()
  /** 分页查询顶层条目。 */
  query(query: NormalizedLibraryQuery): LibraryQueryResult {
    return this.catalogQuery.list(query)
  }

  /** 分面取值与条目数（海报墙筛选面板）。 */
  facetValues(request: FacetListRequest): FacetValue[] {
    return this.catalogQuery.facetValues(request)
  }

  /** 条目详情。 */
  getItem({ itemId }: { itemId: number }): LibraryItemNode | null {
    return this.catalogQuery.getItem(itemId)
  }

  /** 识别条目。 */
  identify(request: IdentifyRequest): JobAccepted {
    if (request.libraryId !== undefined) this.libraries.get(request.libraryId)
    return this.identifier.identify(request)
  }

  /** 条目的匹配候选。 */
  getMatchCandidates({ itemId }: { itemId: number }): MatchCandidatesResult {
    return this.identifier.getMatchCandidates(itemId)
  }

  /** 手动匹配。 */
  async applyMatch(request: ApplyMatchRequest): Promise<ApplyMatchResult> {
    if (this.matching.has(request.itemId))
      throw new LibraryError('conflict', '此条目正在匹配')
    this.matching.add(request.itemId)
    try {
      return await this.identifier.applyMatch(request)
    } finally {
      this.matching.delete(request.itemId)
    }
  }

  /** 锁定匹配。 */
  lockMatch({ itemId }: { itemId: number }): LibraryItemSummary {
    return this.identifier.lockMatch(itemId)
  }

  /** 解除锁定。 */
  unlockMatch({ itemId }: { itemId: number }): LibraryItemSummary {
    return this.identifier.unlockMatch(itemId)
  }

  /** 刷新元数据。 */
  refreshMetadata(request: RefreshMetadataRequest): JobAccepted {
    if (request.libraryId !== undefined) this.libraries.get(request.libraryId)
    return this.identifier.refreshMetadata(request)
  }

  /** 设置元数据源令牌。 */
  setProviderToken(request: SetProviderTokenRequest): ProviderStatus {
    return this.identifier.setProviderToken(request)
  }

  /** 元数据源配置状态。 */
  getProviderStatus(): ProviderStatus {
    return this.identifier.getProviderStatus()
  }
}
