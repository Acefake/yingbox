import { ref } from 'vue'
import { ProcessedItem, FileItem } from '@/types'
import { message } from 'ant-design-vue'

export const useTVFileManagement = () => {
  const fileData = ref<ProcessedItem[]>([])
  const directoryPaths = ref<string[]>([])
  const dirLoading = ref(false)
  const scanProgress = ref({ found: 0, active: false })
  const selectedItems = ref<Set<string>>(new Set())
  const isMultiSelectMode = ref(false)

  /**
   * 打开对话框并添加新目录
   */
  const readDirectory = async (): Promise<void> => {
    try {
      const dialogResult = await window.api.dialog.openDirectory()

      if (
        !dialogResult.success ||
        dialogResult.canceled ||
        !dialogResult.filePaths?.length
      ) {
        return
      }

      const path = dialogResult.filePaths[0]

      if (directoryPaths.value.includes(path)) {
        message.info('该目录已添加')
        return
      }

      const pathCheck = await window.api.file.exists(path)
      if (!pathCheck.success || !pathCheck.exists) {
        message.error('选择的目录不存在')
        return
      }

      dirLoading.value = true
      scanProgress.value = { found: 0, active: true }
      directoryPaths.value = [...directoryPaths.value, path]
      saveDirectoryPaths()

      const files = await readDirectoryRecursive(path)
      fileData.value = [...fileData.value, ...processTVFiles(files)]
      saveToCache()
      message.success('目录添加成功')
    } catch (error) {
      console.error('添加目录失败:', error)
      message.error('添加目录失败')
    } finally {
      dirLoading.value = false
      scanProgress.value.active = false
    }
  }

  /**
   * 移除指定索引的目录
   */
  const removeDirectory = async (index: number): Promise<void> => {
    directoryPaths.value = directoryPaths.value.filter((_, i) => i !== index)
    saveDirectoryPaths()
    await refreshAllDirectories()
  }

  /**
   * 递归读取目录（自定义实现，跳过不存在的目录）
   */
  const readDirectoryRecursive = async (
    dirPath: string
  ): Promise<FileItem[]> => {
    const allFiles: FileItem[] = []

    try {
      const result = await window.api.file.readdir(dirPath)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!result.success || !result.data) {
        return allFiles
      }

      const items = result.data as Array<{
        name: string
        isDirectory: boolean
        isFile: boolean
      }>

      for (const item of items) {
        const fullPath = await window.api.path.join(dirPath, item.name)
        const statResult = await window.api.file.stat(fullPath)

        if (!statResult.success || !statResult.data) {
          continue
        }

        const stat = statResult.data as {
          size: number
          isDirectory: boolean
          isFile: boolean
        }

        scanProgress.value.found++
        allFiles.push({
          name: item.name,
          path: fullPath,
          size: stat.size,
          isDirectory: stat.isDirectory,
          isFile: stat.isFile,
        })

        // 如果是目录，递归读取
        if (item.isDirectory) {
          try {
            const subFiles = await readDirectoryRecursive(fullPath)
            allFiles.push(...subFiles)
          } catch (subError) {
            console.warn(`跳过无法读取的目录: ${fullPath}`, subError)
          }
        }
      }
    } catch (error) {
      console.warn(`读取目录失败，跳过: ${dirPath}`, error)
    }

    return allFiles
  }

  /**
   * 处理电视剧文件结构
   * 自动穿透分类目录，直接提取电视剧根目录
   */
  const processTVFiles = (files: FileItem[]): ProcessedItem[] => {
    if (!files || files.length === 0) return []

    // 1. 识别所有的电视剧根目录（包含季文件夹或符合剧集命名规则的目录）
    const tvShowRoots: FileItem[] = []
    const directories = files.filter(f => f.isDirectory)

    for (const dir of directories) {
      // 检查目录下是否有季文件夹
      const hasSeason = files.some(
        f =>
          f.isDirectory &&
          f.path.startsWith(
            dir.path +
              (dir.path.endsWith('\\') || dir.path.endsWith('/')
                ? ''
                : dir.path.includes('\\')
                  ? '\\'
                  : '/')
          ) &&
          f.path !== dir.path &&
          isTVSeasonFolder(f.name)
      )

      // 如果有季文件夹，且它的父级不是另一个符合条件的剧集目录，则它是根
      if (hasSeason) {
        // 简单判断：如果父级目录名不叫 Season/Sxx，则当前是剧集根
        const parentPath = dir.path.substring(
          0,
          dir.path.lastIndexOf(dir.path.includes('\\') ? '\\' : '/')
        )
        const parentDir = directories.find(d => d.path === parentPath)
        if (!parentDir || !isTVSeasonFolder(parentDir.name)) {
          tvShowRoots.push(dir)
        }
      }
    }

    // 1.5. 补充：目录下有直接视频文件（无季文件夹的平铺结构）
    for (const dir of directories) {
      if (tvShowRoots.some(r => r.path === dir.path)) continue
      if (isTVSeasonFolder(dir.name)) continue
      const sep2 = dir.path.includes('\\') ? '\\' : '/'
      const hasDirectVideos = files.some(f => {
        const parent = f.path.substring(0, f.path.lastIndexOf(sep2))
        return parent === dir.path && f.isFile && isVideoFile(f.name)
      })
      if (hasDirectVideos) tvShowRoots.push(dir)
    }

    // 如果仍然没找到任何根，取最浅子目录作为后备
    if (tvShowRoots.length === 0) {
      const paths = files.map(f => f.path)
      const minDepth = Math.min(...paths.map(p => p.split(/[\\/]/).length))
      return directories
        .filter(d => d.path.split(/[\\/]/).length === minDepth + 1)
        .map(d => buildTVTree(d, files))
    }

    // 2. 构建最终列表：移除包含其他剧集根的外层目录（如 剧集/、大陆/），保留最内层的真实剧集
    const sep = (p: string) => (p.includes('\\') ? '\\' : '/')
    const finalRoots = tvShowRoots.filter(root => {
      return !tvShowRoots.some(
        other =>
          root.path !== other.path &&
          other.path.startsWith(root.path + sep(root.path))
      )
    })

    return finalRoots.map(root => buildTVTree(root, files))
  }

  /**
   * 构建标准的 剧 > 季 > 集 树结构
   */
  const buildTVTree = (
    folder: FileItem,
    allFiles: FileItem[]
  ): ProcessedItem => {
    const childrenFiles = allFiles.filter(f => {
      const p = f.path.substring(
        0,
        f.path.lastIndexOf(f.path.includes('\\') ? '\\' : '/')
      )
      return p === folder.path
    })

    // 识别季
    const seasons = childrenFiles
      .filter(f => f.isDirectory && isTVSeasonFolder(f.name))
      .map(f => buildTVTree(f, allFiles))

    // 识别直接在剧集目录下的视频（有些剧没分季文件夹）
    const videoFiles = childrenFiles
      .filter(f => f.isFile && isVideoFile(f.name))
      .map(f => ({
        name: f.name,
        path: f.path,
        type: 'video' as const,
        episodeNumber: extractEpisodeNumber(f.name),
        hasNfo: allFiles.some(
          nfo => nfo.isFile && nfo.path === f.path.replace(/\.[^.]+$/, '.nfo')
        ),
      }))

    const isSeason = isTVSeasonFolder(folder.name)

    return {
      name: folder.name,
      path: folder.path,
      type: 'folder',
      isSeasonFolder: isSeason,
      seasonNumber: isSeason ? extractSeasonNumber(folder.name) : undefined,
      hasNfo: childrenFiles.some(
        f =>
          f.isFile &&
          (f.name.toLowerCase() === 'tvshow.nfo' ||
            f.name.toLowerCase() === 'season.nfo')
      ),
      hasPoster: childrenFiles.some(
        f =>
          f.isFile &&
          (f.name.toLowerCase() === 'poster.jpg' ||
            f.name.toLowerCase() === 'folder.jpg')
      ),
      hasFanart: childrenFiles.some(
        f =>
          f.isFile &&
          (f.name.toLowerCase() === 'fanart.jpg' ||
            f.name.toLowerCase() === 'backdrop.jpg')
      ),
      children: [...seasons, ...videoFiles],
    }
  }

  /**
   * 判断是否是季文件夹
   */
  const isTVSeasonFolder = (name: string): boolean => {
    const lowerName = name.toLowerCase()
    return /^season\s*\d+/i.test(lowerName) || /^s\d+/i.test(lowerName)
  }

  /**
   * 提取季数
   */
  const extractSeasonNumber = (name: string): number => {
    const match = name.match(/season\s*(\d+)/i) || name.match(/s(\d+)/i)
    return match ? parseInt(match[1]) : 0
  }

  /**
   * 提取集数，支持多种命名格式
   */
  const extractEpisodeNumber = (name: string): number => {
    // 去掉扩展名再匹配
    const base = name.replace(/\.[^.]+$/, '')
    let m: RegExpMatchArray | null

    // S01E01 格式（最常见最可靠）
    m = base.match(/s\d+e(\d+)/i)
    if (m) return parseInt(m[1])

    // 1x01 格式
    m = base.match(/\d+x(\d+)/i)
    if (m) return parseInt(m[1])

    // EP01 / EP.01 格式
    m = base.match(/\bep\.?\s*(\d+)/i)
    if (m) return parseInt(m[1])

    // 独立 E01 格式（大写 E 避免误匹配）
    m = base.match(/\bE(\d{1,3})\b/)
    if (m) return parseInt(m[1])

    // 第01集 / 第1集 格式
    m = base.match(/第\s*(\d+)\s*集/)
    if (m) return parseInt(m[1])

    // 分隔符后的集号: " - 01" / ".01." / "_01_"
    m = base.match(/[\.\-\s_](\d{2,3})[\.\-\s_]/)
    if (m) return parseInt(m[1])

    // 文件名本身就是纯数字: "01" "001"
    m = base.match(/^(\d{1,3})$/)
    if (m) return parseInt(m[1])

    return 0
  }

  /**
   * 判断是否是视频文件
   */
  const isVideoFile = (name: string): boolean => {
    const videoExtensions = [
      '.mp4',
      '.avi',
      '.mkv',
      '.mov',
      '.wmv',
      '.flv',
      '.webm',
      '.m4v',
    ]
    return videoExtensions.some(ext => name.toLowerCase().endsWith(ext))
  }

  /**
   * 从文件名提取季号
   */
  const extractSeasonFromFilename = (filename: string): number | null => {
    const base = filename.replace(/\.[^.]+$/, '')
    const match = base.match(/s(\d+)/i)
    return match ? parseInt(match[1]) : null
  }

  /**
   * 自动组织文件到季文件夹
   * 如果剧集没有季文件夹，根据文件名中的季信息自动创建季文件夹并移动文件
   */
  const organizeFilesIntoSeasons = async (
    tvShowPath: string
  ): Promise<void> => {
    try {
      const files = await readDirectoryRecursive(tvShowPath)

      // 检查是否已有季文件夹
      const hasSeasonFolders = files.some(
        f => f.isDirectory && isTVSeasonFolder(f.name)
      )
      if (hasSeasonFolders) {
        console.log('剧集已有季文件夹，跳过自动组织')
        return
      }

      // 按季分组视频文件
      const seasonGroups: Record<number, FileItem[]> = {}
      const filesWithoutSeason: FileItem[] = []

      for (const file of files) {
        if (!file.isFile || !isVideoFile(file.name)) continue

        const seasonNum = extractSeasonFromFilename(file.name)
        if (seasonNum !== null) {
          if (!seasonGroups[seasonNum]) {
            seasonGroups[seasonNum] = []
          }
          seasonGroups[seasonNum].push(file)
        } else {
          filesWithoutSeason.push(file)
        }
      }

      // 如果没有找到任何季信息，跳过
      if (Object.keys(seasonGroups).length === 0) {
        console.log('未找到季信息，跳过自动组织')
        return
      }

      // 创建季文件夹并移动文件
      for (const [seasonNum, seasonFiles] of Object.entries(seasonGroups)) {
        const seasonFolderName = `Season ${seasonNum}`
        const seasonFolderPath = await window.api.path.join(
          tvShowPath,
          seasonFolderName
        )

        // 创建季文件夹
        const existsCheck = await window.api.file.exists(seasonFolderPath)
        if (!existsCheck.success || !existsCheck.exists) {
          const mkdirResult = await window.api.file.mkdir(seasonFolderPath)
          if (!mkdirResult.success) {
            console.error(`创建季文件夹失败: ${seasonFolderPath}`)
            continue
          }
          console.log(`创建季文件夹: ${seasonFolderPath}`)
        }

        // 移动文件到季文件夹
        for (const file of seasonFiles) {
          const newPath = await window.api.path.join(
            seasonFolderPath,
            file.name
          )
          const moveResult = await window.api.file.move(file.path, newPath)
          if (moveResult.success) {
            console.log(`移动文件: ${file.name} -> ${seasonFolderName}`)

            // 同时移动关联的缩略图文件
            const baseName = file.name.replace(/\.[^.]+$/, '')
            const thumbName = `${baseName}-thumb.jpg`
            const thumbPath = await window.api.path.join(tvShowPath, thumbName)
            const thumbExists = await window.api.file.exists(thumbPath)
            if (thumbExists.success && thumbExists.exists) {
              const newThumbPath = await window.api.path.join(
                seasonFolderPath,
                thumbName
              )
              const thumbMoveResult = await window.api.file.move(
                thumbPath,
                newThumbPath
              )
              if (thumbMoveResult.success) {
                console.log(`移动缩略图: ${thumbName} -> ${seasonFolderName}`)
              }
            }
          } else {
            console.error(`移动文件失败: ${file.name}`)
          }
        }
      }

      message.success(
        `已自动创建 ${Object.keys(seasonGroups).length} 个季文件夹并整理文件`
      )

      // 刷新文件树
      await refreshAllDirectories()
    } catch (error) {
      console.error('自动组织文件失败:', error)
      message.error('自动组织文件失败')
    }
  }

  /**
   * 从文件夹名中提取基础剧名（去掉末尾的季标识）
   * e.g. "某剧 S1" → "某剧"、"某剧 Season 2" → "某剧"、"某剧 第一季" → "某剧"
   */
  const extractSeriesBaseName = (folderName: string): string | null => {
    const patterns = [
      /^(.+?)\s*[Ss]\d+\s*$/,
      /^(.+?)\s*[Ss]eason\s*\d+\s*$/i,
      /^(.+?)\s*第\s*[一二三四五六七八九十百\d]+\s*季\s*$/,
    ]
    for (const p of patterns) {
      const m = folderName.match(p)
      if (m) return m[1].trim()
    }
    return null
  }

  /**
   * 检测并合并散落的同名系列季文件夹
   * e.g. 某剧S1\ 某剧S2\ → 某剧\Season 1\ 某剧\Season 2\
   * @param parentDirPath 包含这些季文件夹的父目录路径
   * @returns 是否执行了合并
   */
  const mergeSeriesSeasons = async (
    parentDirPath: string
  ): Promise<boolean> => {
    try {
      const result = await window.api.file.readdir(parentDirPath)
      if (!result.success || !result.data) return false

      const sep = parentDirPath.includes('\\') ? '\\' : '/'
      const items = result.data as Array<{ name: string; isDirectory: boolean }>
      const dirs = items.filter(i => i.isDirectory)

      // 按基础剧名分组
      const groups: Record<
        string,
        Array<{ name: string; seasonNum: number }>
      > = {}
      for (const dir of dirs) {
        const base = extractSeriesBaseName(dir.name)
        if (!base) continue
        const sNum = extractSeasonNumber(dir.name)
        if (!groups[base]) groups[base] = []
        groups[base].push({ name: dir.name, seasonNum: sNum })
      }

      // 只处理有2个及以上季文件夹的分组
      const toMerge = Object.entries(groups).filter(
        ([, seasons]) => seasons.length >= 2
      )
      if (toMerge.length === 0) return false

      let merged = false
      for (const [baseName, seasons] of toMerge) {
        const parentFolder = parentDirPath + sep + baseName

        // 创建父文件夹
        const existsCheck = await window.api.file.exists(parentFolder)
        if (!existsCheck.success || !existsCheck.exists) {
          const mkResult = await window.api.file.mkdir(parentFolder)
          if (!mkResult.success) {
            console.error(`创建父文件夹失败: ${parentFolder}`)
            continue
          }
        }

        // 移动每个季文件夹到父文件夹，并重命名为 Season N
        for (const season of seasons) {
          const srcPath = parentDirPath + sep + season.name
          const destName = `Season ${season.seasonNum || 1}`
          const destPath = parentFolder + sep + destName
          const moveResult = await window.api.file.move(srcPath, destPath)
          if (moveResult.success) {
            console.log(`合并季: ${season.name} → ${baseName}/${destName}`)
          } else {
            console.error(`移动季文件夹失败: ${season.name}`, moveResult)
          }
        }
        merged = true
      }

      if (merged) {
        message.success(`已自动合并同名季文件夹`)
      }
      return merged
    } catch (error) {
      console.error('合并季文件夹失败:', error)
      return false
    }
  }

  /**
   * 从所有已添加目录重新读取（内部用）
   */
  const refreshAllDirectories = async (): Promise<void> => {
    if (directoryPaths.value.length === 0) {
      fileData.value = []
      saveToCache()
      return
    }

    scanProgress.value = { found: 0, active: true }
    const allItems: ProcessedItem[] = []
    for (const path of directoryPaths.value) {
      try {
        const pathCheck = await window.api.file.exists(path)
        if (!pathCheck.success || !pathCheck.exists) continue
        const files = await readDirectoryRecursive(path)
        allItems.push(...processTVFiles(files))
      } catch (e) {
        console.warn('读取目录失败，跳过:', path, e)
      }
    }
    fileData.value = allItems
    saveToCache()
    scanProgress.value.active = false
  }

  /**
   * 刷新文件列表
   */
  const refreshFiles = async (): Promise<void> => {
    if (directoryPaths.value.length === 0) {
      const loaded = loadFromCache()
      if (!loaded) message.info('请先添加文件夹')
      return
    }

    dirLoading.value = true
    try {
      await refreshAllDirectories()
      message.success('刷新完成')
    } catch (error) {
      console.error('刷新失败:', error)
      message.error('刷新失败')
    } finally {
      dirLoading.value = false
    }
  }

  /**
   * 持久化目录列表
   */
  const saveDirectoryPaths = (): void => {
    localStorage.setItem('tvDirectories', JSON.stringify(directoryPaths.value))
  }

  /**
   * 保存文件数据缓存
   */
  const saveToCache = (): void => {
    try {
      localStorage.setItem('tvFileData', JSON.stringify(fileData.value))
    } catch (error) {
      console.error('保存缓存失败:', error)
    }
  }

  /**
   * 从缓存加载（同时恢复目录列表）
   */
  const loadFromCache = (): boolean => {
    try {
      const dirs = localStorage.getItem('tvDirectories')
      if (dirs) directoryPaths.value = JSON.parse(dirs)
      const cached = localStorage.getItem('tvFileData')
      if (cached) {
        fileData.value = JSON.parse(cached)
        return true
      }
    } catch (error) {
      console.error('加载缓存失败:', error)
    }
    return false
  }

  /**
   * 清除缓存
   */
  const clearCache = (): void => {
    try {
      localStorage.removeItem('tvFileData')
      localStorage.removeItem('tvDirectories')
      fileData.value = []
      directoryPaths.value = []
    } catch (error) {
      console.error('清除缓存失败:', error)
    }
  }

  /**
   * 切换选择状态
   */
  const toggleSelection = (item: ProcessedItem, _index: number): void => {
    if (selectedItems.value.has(item.path)) {
      selectedItems.value.delete(item.path)
    } else {
      selectedItems.value.add(item.path)
    }
  }

  /**
   * 切换多选模式
   */
  const toggleMultiSelect = (): void => {
    isMultiSelectMode.value = !isMultiSelectMode.value
    if (!isMultiSelectMode.value) {
      selectedItems.value.clear()
    }
  }

  /**
   * 全选
   */
  const selectAll = (): void => {
    fileData.value.forEach(item => {
      selectedItems.value.add(item.path)
    })
  }

  /**
   * 清除选择
   */
  const clearSelection = (): void => {
    selectedItems.value.clear()
  }

  return {
    fileData,
    directoryPaths,
    scanProgress,
    dirLoading,
    selectedItems,
    isMultiSelectMode,
    readDirectory,
    removeDirectory,
    refreshFiles,
    loadFromCache,
    clearCache,
    toggleSelection,
    toggleMultiSelect,
    selectAll,
    clearSelection,
    organizeFilesIntoSeasons,
    mergeSeriesSeasons,
  }
}
