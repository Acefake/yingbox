/** 可识别的设置缺失状态，不依赖展示文案。 */
export class SearchSetupError extends Error {}
export function needsSearchSetup(error: unknown): boolean {
  return (
    error instanceof SearchSetupError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'not_configured')
  )
}
