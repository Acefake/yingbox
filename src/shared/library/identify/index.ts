/**
 * 识别链与识别输入：NFO 读取（ID 与描述信息）、国家名换算、OpenSubtitles moviehash。
 */
export {
  DETAIL_TOP_N,
  type HashLookup,
  type IdentifyDeps,
  type IdentifyInput,
  type IdentifyResult,
  type IdentifySource,
  type LocalEpisodes,
  identify,
} from './identify'
export { type ByteSource, computeMovieHash } from './movie-hash'
export { type NfoInfo, type NfoKind, parseNfo } from './nfo'
export {
  type NfoDetails,
  hasNfoDetails,
  parseNfoDetails,
  xmlText,
} from './nfo-details'
export { countryCode, countryCodes } from './country-codes'
