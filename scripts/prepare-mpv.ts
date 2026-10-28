import { dirname, join, resolve } from 'node:path'
import {
  distribution,
  prepareMpvDistribution,
} from '../src/main/mpv-distribution'

async function main(): Promise<void> {
  const root = resolve(dirname(process.argv[1]), '..')
  const exe = await prepareMpvDistribution({
    dest: join(root, 'resources/mpv'),
    cache: join(root, 'output/mpv-cache/packages'),
    tar: join(process.env.WINDIR || 'C:/Windows', 'System32/tar.exe'),
    fetcher: url => fetch(url),
    force: process.argv.includes('--force'),
  })
  console.log(`[fetch:mpv] ${distribution.id}: ${exe}`)
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
