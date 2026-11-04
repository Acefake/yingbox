package com.yingbox.android.update

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseMirrorsTest {
    @Test
    fun `白名单主机官方在前再套 gh-proxy`() {
        val api = "https://api.github.com/repos/Acefake/yingbox/releases?per_page=30"
        assertEquals(
            listOf(api, ReleaseMirrors.PREFIX + api),
            ReleaseMirrors.candidates(api),
        )
        val asset = "https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe"
        assertEquals(ReleaseMirrors.PREFIX + asset, ReleaseMirrors.candidates(asset)[1])
        assertEquals(
            2,
            ReleaseMirrors.candidates(
                "https://objects.githubusercontent.com/github-production-release-asset-2e65be/x",
            ).size,
        )
    }

    @Test
    fun `非白名单或不合法不套镜像`() {
        assertEquals(
            listOf("https://example.com/a"),
            ReleaseMirrors.candidates("https://example.com/a"),
        )
        assertEquals(emptyList<String>(), ReleaseMirrors.candidates("http://github.com/a"))
        assertEquals(emptyList<String>(), ReleaseMirrors.candidates("not-a-url"))
    }

    @Test
    fun `安装包候选拒绝非 GitHub 主机`() {
        assertEquals(emptyList<String>(), ReleaseMirrors.githubAssetCandidates("https://example.com/a.apk"))
        val asset = "https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe"
        assertEquals(
            listOf(asset, ReleaseMirrors.PREFIX + asset),
            ReleaseMirrors.githubAssetCandidates(asset),
        )
    }

    @Test
    fun `可重试判定`() {
        assertTrue(ReleaseMirrors.canRetryDownload(IOException("fail")))
        assertTrue(ReleaseMirrors.canRetryDownload(IllegalStateException("下载失败：HTTP 503")))
        assertTrue(ReleaseMirrors.canRetryDownload(IllegalStateException("下载失败：HTTP 429")))
        assertFalse(ReleaseMirrors.canRetryDownload(IllegalStateException("下载失败：HTTP 404")))
        assertFalse(ReleaseMirrors.canRetryDownload(IllegalStateException("下载失败：HTTP 403")))
        assertTrue(ReleaseMirrors.canRetryDownload(IllegalStateException("安装包校验失败，请重试")))
        assertTrue(ReleaseMirrors.isGithubMirrorHost("api.github.com"))
        assertFalse(ReleaseMirrors.isGithubMirrorHost("evil.com"))
    }
}
