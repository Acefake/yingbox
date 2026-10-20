/**
 * 扫描器的数据形状：数据库快照（上次扫描的结果）与本次扫描得到的差异。
 */
import type { LibraryFileKind } from '../../../shared/library/ipc'

/** 快照里的一个目录。 */
export interface StoredDir {
  key: string
  displayPath: string
  mtime: number
}

/** 快照里的一个文件。 */
export interface StoredFile {
  id: number
  key: string
  displayPath: string
  dir: string
  name: string
  kind: LibraryFileKind
  size: number
  mtime: number
  fingerprint: string | null
}

/**
 * 上次扫描结果的只读视图。扫描器只通过它读旧状态，不直接碰数据库，所以能用内存实现单测。
 */
export interface ScanSnapshot {
  getDir(key: string): StoredDir | undefined
  /** 某目录的直接子目录。 */
  childDirs(key: string): StoredDir[]
  /** 某目录的直接文件。 */
  filesIn(dirKey: string): StoredFile[]
  /** 某目录整棵子树下的全部文件（用于目录被删 / 改名时的移动识别）。 */
  filesUnder(dirKey: string): StoredFile[]
}

/** 本次扫描在磁盘上看到的一个文件。 */
export interface ScannedFile {
  key: string
  displayPath: string
  dir: string
  name: string
  kind: LibraryFileKind
  size: number
  mtime: number
}

/** 一个需要写回的目录：自身 mtime 与直接文件的增删改。 */
export interface DirChange {
  dir: {
    key: string
    displayPath: string
    parent: string | null
    mtime: number
  }
  added: ScannedFile[]
  changed: Array<ScannedFile & { id: number }>
  removed: StoredFile[]
}

/** 一棵消失的子树（目录被删或改名）。 */
export interface RemovedDir {
  key: string
  files: StoredFile[]
}

/** 一次扫描相对快照的差异。 */
export interface ScanDiff {
  dirChanges: DirChange[]
  removedDirs: RemovedDir[]
  warnings: string[]
  stats: {
    /** stat 过的目录数。 */
    dirsVisited: number
    /** 命中 mtime 短路、没有 readdir 的目录数。 */
    dirsReused: number
    /** stat 过的文件数。 */
    filesStatted: number
  }
}
