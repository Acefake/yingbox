import { TMDB } from "@tdanks2000/tmdb-wrapper";
const ACCESS_TOKEN = ''
const tmdb = new TMDB(ACCESS_TOKEN)
const TMDB_IMG_URL = 'https://image.tmdb.org/t/p/w500'
export { tmdb, TMDB_IMG_URL }
