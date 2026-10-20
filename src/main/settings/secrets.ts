/**
 * 敏感设置的加解密：交给系统密钥存储（Windows DPAPI / macOS Keychain / libsecret）。
 * store 只保存密文，明文只在主进程内存里出现。
 */
import { safeStorage } from 'electron'

/** 密文编解码器；测试可替换为不依赖 Electron 的实现 */
export interface SecretCodec {
  /** 系统密钥存储是否可用 */
  available(): boolean
  /** 明文 → base64 密文 */
  encrypt(plain: string): string
  /** base64 密文 → 明文；无法解密时抛错 */
  decrypt(cipher: string): string
}

/** 基于 Electron safeStorage 的编解码器 */
export const safeStorageCodec: SecretCodec = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: plain => safeStorage.encryptString(plain).toString('base64'),
  decrypt: cipher => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
}
