/**
 * 路径布局：作品文件夹与整理基准。剧集文件直接放在分类文件夹（「大陆」「美剧」）里时，
 * 分类文件夹不是作品文件夹，整理以它为基准（ADR-0029）。
 */
import { describe, expect, it } from 'vitest'

import { folderLayout } from '../../src/shared/library/parser'

const layout = (path: string): { owner: number; base: number } => {
  const parts = path.split('/')
  return folderLayout(parts.slice(0, -1), parts.at(-1))
}

describe('folderLayout', () => {
  it('散放在分类文件夹里的集：没有作品文件夹，基准是分类文件夹', () => {
    expect(layout('剧集/大陆/Where.the.Mask.Ends.S01E09.2160p.mkv')).toEqual({
      owner: 0,
      base: 2,
    })
    expect(layout('美剧/Severance.S02E01.mkv')).toEqual({ owner: 0, base: 1 })
  })

  it('剧文件夹带年份或外部 id：仍是作品文件夹，哪怕文件名用别的语言', () => {
    expect(
      layout(
        '剧集/大陆/嫁金钗 (2026) {tmdb-300146}/Where.the.Mask.Ends.S01E09.mkv'
      )
    ).toEqual({ owner: 3, base: 2 })
    expect(layout('剧集/嫁金钗 (2026)/Where.the.Mask.Ends.S01E09.mkv')).toEqual(
      { owner: 2, base: 1 }
    )
  })

  it('中文剧名文件夹里放英文发布名的集：仍是作品文件夹，不当分类', () => {
    expect(
      layout('剧集/繁花/Blossoms.Shanghai.2023.S01E01.1080p.WEB-DL.mkv')
    ).toEqual({
      owner: 2,
      base: 1,
    })
    expect(layout('狂飙/The.Knockout.S01E01.2160p.WEB-DL.mkv')).toEqual({
      owner: 1,
      base: 0,
    })
  })

  it('文件夹名与文件里的剧名对得上：作品文件夹', () => {
    expect(layout('剧集/交锋/交锋.S01E01.mkv')).toEqual({ owner: 2, base: 1 })
  })

  it('中间隔着季文件夹：上面那层是作品文件夹', () => {
    expect(layout('剧集/大陆/Season 1/Where.the.Mask.Ends.S01E09.mkv')).toEqual(
      {
        owner: 2,
        base: 1,
      }
    )
  })

  it('发布包文件夹：作品文件夹', () => {
    expect(
      layout(
        '剧集/Mystic.Nine.S01.2160p.WEB-DL.H.265-HiveWeb/Lao.Jiu.Men.E01.mkv'
      )
    ).toEqual({ owner: 2, base: 1 })
  })

  it('电影或不传文件名：维持原来的作品文件夹判定', () => {
    expect(folderLayout(['电影', '大陆'])).toEqual({ owner: 2, base: 1 })
    expect(layout('电影/大陆/流浪地球.2019.mkv')).toEqual({ owner: 2, base: 1 })
    expect(layout('x.S01E01.mkv')).toEqual({ owner: 0, base: 0 })
  })
})
