package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewApi
import com.yingbox.android.view.ViewSearchCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 搜索页：在各站点里按片名搜，同名合成一张卡；点开用片名走选源（没有豆瓣详情）。
 * 一次搜索最久 12 秒，期间显示「搜索中」。
 */
@Composable
fun SearchScreen(client: ServerClient, chrome: PaddingValues, open: (ViewSearchCard) -> Unit) {
    val dir = LocalLayoutDirection.current
    var query by rememberSaveable { mutableStateOf("") }
    // 提交过的关键词；null 表示还没搜
    var submitted by rememberSaveable { mutableStateOf<String?>(null) }
    val result by produceState<Result<List<ViewSearchCard>>?>(null, submitted, client) {
        val keyword = submitted
        value = if (keyword == null) null else withContext(Dispatchers.IO) { runCatching { ViewApi(client).search(keyword) } }
    }
    val gutter = gutter()
    LazyVerticalGrid(
        columns = GridCells.Adaptive(132.dp),
        modifier = Modifier.fillMaxSize().background(YbColor.Base),
        contentPadding = PaddingValues(
            start = gutter + chrome.calculateStartPadding(dir),
            end = gutter + chrome.calculateEndPadding(dir),
            top = chrome.calculateTopPadding(),
            bottom = chrome.calculateBottomPadding(),
        ),
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(YbSpace.S6),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) { PageTitle("搜索") }
        item(span = { GridItemSpan(maxLineSpan) }) {
            SearchField(query, { query = it }) { submitted = query.trim().ifEmpty { null } }
        }
        val list = result?.getOrNull()
        val note = when {
            submitted == null -> "输入片名，回车搜索"
            result == null -> "搜索中…（最久 12 秒）"
            list == null -> "搜索失败，稍后再试"
            list.isEmpty() -> "没有找到「$submitted」"
            else -> null
        }
        if (note != null) item(span = { GridItemSpan(maxLineSpan) }) { Text(note, color = Muted, fontSize = YbText.Sm) }
        if (list != null) items(list, key = { it.title }) { card -> SearchPoster(card, client) { open(card) } }
    }
}

/** 搜索框：实色胶囊，左边放大镜；回车（输入法的搜索键）提交 */
@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, submit: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(48.dp).background(YbColor.Elevated, YbRadius.Full).padding(horizontal = YbSpace.S4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(YbIcons.Search, contentDescription = null, tint = YbColor.TextSecondary, modifier = Modifier.size(20.dp))
        Box(Modifier.weight(1f).padding(start = YbSpace.S3)) {
            RemoteTextField(
                value = value,
                onChange = onChange,
                placeholder = "搜索片名",
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                onAction = submit,
            )
        }
    }
}

/** 一张搜索结果：海报（没有时灰底）、片名、年份 · 类型 · 站点数 */
@Composable
private fun SearchPoster(card: ViewSearchCard, client: ServerClient, open: () -> Unit) {
    Column(Modifier.width(132.dp).tvFocusViewport(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        RemoteImage(
            card.poster,
            client,
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).focusFrame(lift = true, onClick = open).clip(YbRadius.Card),
        )
        Text(card.title, color = YbColor.TextPrimary, fontSize = YbText.Md, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val sub = listOf(card.year, card.tag, "${card.siteCount.toInt()} 个源").filter { it.isNotEmpty() }.joinToString(" · ")
        Text(sub, color = Muted, fontSize = YbText.Xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
