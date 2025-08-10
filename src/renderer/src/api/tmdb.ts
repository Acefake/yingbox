import { TMDB } from '@tdanks2000/tmdb-wrapper'

const ACCESS_TOKEN =
  ''

const tmdb = new TMDB(ACCESS_TOKEN)

// https://images.tmdb.org/t/p/original/iqg69qhSa09znkL9RiCO0VQgEM4.png
const TMDB_IMG_URL = 'https://images.tmdb.org/t/p/original'

tmdb.movies.images(11).then((res) => {
  console.log(res)
})
export { TMDB_IMG_URL, tmdb }
