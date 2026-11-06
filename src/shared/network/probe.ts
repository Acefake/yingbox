import type { NetClient } from '../net/client'
import { mirrorCandidates } from '../release/mirrors'
import type { NetworkPreferences } from './preferences'

/** 单项探测只表示当前设备上的具体能力，不承诺长期可用。 */
export interface NetworkProbeResult {
  endpoint: string
  purpose: string
  ok: boolean
  detail: string
}

/** 固定公开样本探测；不接收任意目标，不读取或发送用户令牌。 */
export async function probeNetwork(
  net: NetClient,
  preferences: NetworkPreferences
): Promise<NetworkProbeResult[]> {
  const raw =
    'https://raw.githubusercontent.com/octocat/Hello-World/master/README'
  const api = 'https://api.github.com/repos/octocat/Hello-World'
  const release =
    'https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_checksums.txt'
  const jobs = [
    ...mirrorCandidates(raw, preferences).map(url => ({
      url,
      purpose: 'GitHub Raw',
      kind: 'raw',
    })),
    ...mirrorCandidates(release, preferences).map(url => ({
      url,
      purpose: 'GitHub Release',
      kind: 'release',
    })),
    ...mirrorCandidates(api, preferences).map(url => ({
      url,
      purpose: 'GitHub API',
      kind: 'api',
    })),
    {
      url: 'https://api.themoviedb.org/3/configuration',
      purpose: 'TMDB 主 API',
      kind: 'tmdb',
    },
    {
      url: 'https://api.tmdb.org/3/configuration',
      purpose: 'TMDB 备用 API',
      kind: 'tmdb',
    },
    {
      url: 'https://image.tmdb.org/t/p/w92/wwemzKWzjKYJFfCeiB57q3r4Bcm.png',
      purpose: 'TMDB 图片',
      kind: 'image',
    },
  ]
  const results: NetworkProbeResult[] = []
  for (let offset = 0; offset < jobs.length; offset += 3) {
    results.push(
      ...(await Promise.all(
        jobs.slice(offset, offset + 3).map(async job => {
          try {
            const response = await net.request(job.url, {
              timeoutMs: 6000,
              maxBytes: 128 * 1024,
            })
            const text = new TextDecoder().decode(response.body)
            let valid = false
            if (job.kind === 'raw')
              valid = response.status === 200 && text.trim() === 'Hello World!'
            if (job.kind === 'release')
              valid =
                response.status === 200 &&
                /^[a-f0-9]{64}\s+gh_2\.65\.0_/m.test(text)
            if (job.kind === 'api')
              valid =
                response.status === 200 &&
                JSON.parse(text).full_name === 'octocat/Hello-World'
            if (job.kind === 'tmdb')
              valid =
                response.status === 401 && JSON.parse(text).status_code === 7
            if (job.kind === 'image')
              valid =
                response.status === 200 &&
                response.body[0] === 137 &&
                response.body[1] === 80 &&
                response.body[2] === 78 &&
                response.body[3] === 71
            return {
              endpoint: job.url,
              purpose: job.purpose,
              ok: valid,
              detail: valid
                ? job.kind === 'tmdb'
                  ? '网络可达，未验证 Token'
                  : '样本验证通过'
                : `HTTP ${response.status}，样本不匹配`,
            }
          } catch {
            return {
              endpoint: job.url,
              purpose: job.purpose,
              ok: false,
              detail: '连接失败或超时，请检查网络后重试',
            }
          }
        })
      ))
    )
  }
  return results
}
