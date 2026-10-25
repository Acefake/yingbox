/** 本地界面口令不进入检索或模型请求。 */
export const ADULT_MODE_PASSPHRASE = 'getav'
export const isSearchCommand = (text: string): boolean =>
  text.trim().toLowerCase() === ADULT_MODE_PASSPHRASE
