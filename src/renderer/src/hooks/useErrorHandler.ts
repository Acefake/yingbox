import { message } from 'ant-design-vue'

/**
 * 错误处理hook
 */
export const useErrorHandler = () => {
  /**
   * 安全执行异步函数，统一处理错误
   */
  const safeExecute = async <T>(
    fn: () => Promise<T>,
    errorMessage: string = '操作失败',
    successMessage?: string
  ): Promise<T | null> => {
    try {
      const result = await fn()
      if (successMessage) {
        message.success(successMessage)
      }
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      message.error(`${errorMessage}: ${errorMsg}`)
      return null
    }
  }

  /**
   * 安全执行同步函数，统一处理错误
   */
  const safeExecuteSync = <T>(
    fn: () => T,
    errorMessage: string = '操作失败',
    successMessage?: string
  ): T | null => {
    try {
      const result = fn()
      if (successMessage) {
        message.success(successMessage)
      }
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      message.error(`${errorMessage}: ${errorMsg}`)
      return null
    }
  }

  return {
    safeExecute,
    safeExecuteSync,
  }
}

