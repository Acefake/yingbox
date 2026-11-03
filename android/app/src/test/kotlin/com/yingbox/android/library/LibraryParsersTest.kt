package com.yingbox.android.library

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LibraryParsersTest {
    @Test fun `海报地址三种形态`() {
        assertEquals("/media/image/abc123?w=300", mediaImageUrl("yingbox-media://image/abc123", 300))
        assertEquals("/media/image/abc123?w=300", mediaImageUrl("yingbox-media://image/abc123?w=780", 300))
        assertEquals(
            "/media/thumb?w=300&src=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fx.jpg",
            mediaImageUrl("https://image.tmdb.org/t/p/w500/x.jpg", 300),
        )
        assertNull(mediaImageUrl(null, 300))
        assertNull(mediaImageUrl("", 300))
        assertNull(mediaImageUrl("file:///x.jpg", 300))
    }

    @Test fun `解析海报墙列表`() {
        val json = JSONObject(
            """{"items":[
              {"id":7,"type":"movie","title":"沙丘","year":2021,"rating":8.0,"poster":"yingbox-media://image/p7","backdrop":null},
              {"id":9,"type":"series","title":"三体","year":null,"rating":null,"poster":null,"backdrop":"https://x/b.jpg"}
            ],"total":42,"offset":0,"limit":200}""",
        )
        val page = parseQuery(json)
        assertEquals(42, page.total)
        assertEquals(2, page.items.size)
        assertEquals(LibraryCard(7, LibraryType.Movie, "沙丘", 2021, 8.0, "/media/image/p7?w=300", null), page.items[0])
        assertEquals(LibraryType.Series, page.items[1].type)
        assertNull(page.items[1].year)
        assertNull(page.items[1].poster)
        assertEquals("/media/thumb?w=780&src=https%3A%2F%2Fx%2Fb.jpg", page.items[1].backdrop)
    }

    @Test fun `电影详情用服务端排好的版本并标出杜比视界`() {
        val json = JSONObject(
            """{"id":7,"type":"movie","title":"沙丘","year":2021,"rating":8.0,"poster":null,"backdrop":null,
              "overview":"沙漠星球","runtime":155,"genres":["科幻","冒险"],
              "files":[
                {"id":70,"kind":"nfo","size":1},
                {"id":72,"kind":"video","size":4000,"video":{"range":"hdr10","dvProfile":null,"dvCompat":null}},
                {"id":71,"kind":"video","size":9000000000,"video":{"range":"dv","dvProfile":8,"dvCompat":1}},
                {"id":73,"kind":"video","size":3000,"video":null},
                {"id":74,"kind":"video","size":3000,"video":null}
              ],
              "versions":[
                {"key":"f71","fileIds":[71],"height":2160,"range":"dv","size":9000000000},
                {"key":"f72","fileIds":[72],"height":1080,"range":"hdr10","size":4000},
                {"key":"f73","fileIds":[73,74],"height":null,"range":null,"size":6000}
              ],"children":[]}""",
        )
        val item = parseItem(json)
        assertEquals("沙漠星球", item.overview)
        assertEquals(155, item.runtimeMin)
        assertEquals(listOf("科幻", "冒险"), item.genres)
        assertEquals(listOf(listOf(71L), listOf(72L), listOf(73L, 74L)), item.versions.map { it.fileIds })
        assertEquals(listOf("杜比视界 P8", "HDR10", null), item.versions.map { it.badge })
        assertEquals(listOf(2160, 1080, null), item.versions.map { it.height })
        assertEquals(emptyList<LibraryEpisode>(), item.episodes)
    }

    @Test fun `旧服务没有 versions 时每个视频文件一个版本`() {
        val json = JSONObject(
            """{"id":7,"type":"movie","title":"沙丘","files":[
                {"id":70,"kind":"nfo","size":1},
                {"id":71,"kind":"video","size":9,"video":{"range":"dv","dvProfile":5,"dvCompat":0}},
                {"id":72,"kind":"video","size":4,"video":null}
              ],"children":[]}""",
        )
        val versions = parseItem(json).versions
        assertEquals(listOf(listOf(71L), listOf(72L)), versions.map { it.fileIds })
        assertEquals(listOf("杜比视界 P5", null), versions.map { it.badge })
    }

    @Test fun `版本按钮的文字`() {
        assertEquals("2160p · 杜比视界 P8 · 8.4 GB", versionLabel(LibraryVersion(listOf(1), 2160, "杜比视界 P8", 9_000_000_000L)))
        assertEquals("1.0 GB · 2 段", versionLabel(LibraryVersion(listOf(1, 2), null, null, 1_073_741_824L)))
    }

    @Test fun `剧集详情把季下的集摊平并排序`() {
        val json = JSONObject(
            """{"id":9,"type":"series","title":"三体","year":2023,"rating":null,"poster":null,"backdrop":null,
              "overview":null,"runtime":null,"genres":[],"files":[],
              "children":[
                {"id":92,"type":"season","title":"第 2 季","seasonNumber":2,"episodeNumber":null,"files":[],"children":[
                  {"id":921,"type":"episode","title":"第一集","seasonNumber":2,"episodeNumber":1,"overview":"开始",
                   "files":[{"id":9210,"kind":"video","size":1,"video":null}],"children":[]}
                ]},
                {"id":91,"type":"season","title":"第 1 季","seasonNumber":1,"episodeNumber":null,"files":[],"children":[
                  {"id":912,"type":"episode","title":"第二集","seasonNumber":1,"episodeNumber":2,"overview":null,
                   "files":[{"id":9120,"kind":"video","size":1,"video":null}],"children":[]},
                  {"id":911,"type":"episode","title":"第一集","seasonNumber":null,"episodeNumber":1,"overview":null,
                   "files":[],"children":[]}
                ]}
              ]}""",
        )
        val episodes = parseItem(json).episodes
        assertEquals(listOf(911L, 912L, 921L), episodes.map { it.itemId })
        assertEquals(listOf(1, 1, 2), episodes.map { it.season })
        assertEquals(listOf(1, 2, 1), episodes.map { it.episode })
        assertEquals("开始", episodes[2].overview)
        assertEquals(emptyList<LibraryVersion>(), episodes[0].versions)
        assertEquals(listOf(9210L), episodes[2].versions.single().fileIds)
    }

    @Test fun `解析进度`() {
        val json = JSONArray(
            """[{"itemId":7,"fileId":71,"position":120.5,"duration":9300,"watched":false,"updatedAt":1},
                {"itemId":8,"fileId":null,"position":0,"duration":0,"watched":true,"updatedAt":2}]""",
        )
        val list = parseProgress(json)
        assertEquals(LibraryProgress(7, 71L, 120.5, 9300.0, false), list[0])
        assertEquals(LibraryProgress(8, null, 0.0, 0.0, true), list[1])
    }

    @Test fun `解析外挂字幕列表`() {
        val json = JSONObject("""{"subtitles":[{"name":"中文","ext":"srt","url":"/media/subtitles/71/a.srt"}]}""")
        assertEquals(listOf(LibrarySubtitle("中文", "/media/subtitles/71/a.srt")), parseSubtitles(json))
    }
}
