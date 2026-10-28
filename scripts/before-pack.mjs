import { generateNotices } from './third-party-notices.mjs'

/** electron-builder runs this before collecting extraResources. */
export default function beforePack() {
  generateNotices()
}
