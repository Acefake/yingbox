package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yingbox.android.server.ServerClient
import com.yingbox.android.view.ViewDetail

/** 详情头部的操作：播放（没有可播的源时为空）和收藏 */
class DetailActions(
    /** 主按钮上的字，如「播放 第01集」 */
    val playLabel: String,
    val play: (() -> Unit)?,
    val favorite: Boolean,
    val toggleFavorite: () -> Unit,
)

/**
 * 详情头部。有剧照时照本地电影 / 剧集详情页（Apple TV 式）：剧照铺满，渐暗到页面底色，
 * 文案在左下——大号片名、白色播放胶囊 + 玻璃圆形收藏钮、简介、评分 · 年份 · 时长 · 类型、导演和主演。
 * 手机使用竖版海报铺满头部，宽屏使用横版剧照；文案叠在图片下方的渐暗区域。
 */
@Composable
internal fun DetailHeader(
    detail: ViewDetail?,
    title: String,
    poster: String,
    /** 卡片自带的剧照：详情还没取到（或取不到）时就用它，版式不会等详情晚到才变 */
    cardBackdrop: String?,
    client: ServerClient,
    actions: DetailActions,
    onActionsFocused: () -> Unit,
) {
    val backdrop = detail?.backdrop ?: cardBackdrop?.takeIf { it.isNotEmpty() }
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val cover = if (wide) backdrop else detail?.poster?.takeIf { it.isNotEmpty() } ?: poster.takeIf { it.isNotEmpty() } ?: backdrop
    if (cover != null) CinemaHeader(detail, title, cover, client, actions, onActionsFocused)
    else PosterHeader(detail, title, poster, client, actions, onActionsFocused)
}

/** 剧照铺满的头部（本地详情页的版式） */
@Composable
private fun CinemaHeader(detail: ViewDetail?, title: String, backdrop: String, client: ServerClient, actions: DetailActions, onActionsFocused: () -> Unit) {
    val gutter = gutter()
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    Box(Modifier.fillMaxWidth().heightIn(min = detailHeroMinHeight()), contentAlignment = Alignment.BottomStart) {
        RemoteImage(backdrop, client, Modifier.matchParentSize())
        Box(Modifier.matchParentSize().background(heroScrim()))
        Box(Modifier.matchParentSize().background(heroSideScrim()))
        Column(
            Modifier.fillMaxWidth(if (wide) 0.6f else 1f).padding(start = gutter, end = gutter, top = belowBackButton(), bottom = YbSpace.S6),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S3),
        ) {
            Text(detail?.title ?: title, color = YbColor.TextPrimary, fontSize = YbText.Xl3, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(
                Modifier.onFocusChanged { if (it.hasFocus) onActionsFocused() }.focusGroup(),
                horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (actions.play != null) PrimaryButton(actions.playLabel, YbIcons.Play, actions.play)
                if (detail != null) GlassIconButton(
                    if (actions.favorite) YbIcons.HeartFill else YbIcons.Heart,
                    if (actions.favorite) "取消收藏" else "收藏",
                    media = true,
                    onClick = actions.toggleFavorite,
                )
            }
            if (detail != null && detail.overview.isNotEmpty()) Overview(detail.overview, collapsible = true, lines = 2, tapToExpand = true)
            if (detail != null) MetaRow(detail)
            val credits = listOf(
                "导演" to (detail?.directors?.take(2)?.joinToString(" / ") ?: ""),
                "主演" to (detail?.actors?.take(4)?.joinToString(" / ") { it.name } ?: ""),
            ).filter { it.second.isNotEmpty() }
            for ((label, names) in credits) {
                Row {
                    Text(label, color = YbColor.TextTertiary, fontSize = YbText.Xs, modifier = Modifier.width(40.dp))
                    Text(names, color = YbColor.TextSecondary, fontSize = YbText.Xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** 竖版海报与片名并排，播放操作和详细资料放在下方。 */
@Composable
private fun PosterHeader(detail: ViewDetail?, title: String, poster: String, client: ServerClient, actions: DetailActions, onActionsFocused: () -> Unit) {
    val gutter = gutter()
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    Box(Modifier.fillMaxWidth().heightIn(min = if (wide) detailHeroMinHeight() else 0.dp), contentAlignment = Alignment.BottomStart) {
        if (wide) {
            RemoteImage(detail?.backdrop ?: poster, client, Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(heroScrim()))
        }
        Column(
            Modifier.padding(start = gutter, end = gutter, top = belowBackButton(), bottom = YbSpace.S6),
            verticalArrangement = Arrangement.spacedBy(YbSpace.S4),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(YbSpace.S4), verticalAlignment = Alignment.Bottom) {
                RemoteImage(
                    detail?.poster?.ifEmpty { null } ?: poster,
                    client,
                    Modifier.width(if (wide) 160.dp else minOf(144.dp, LocalConfiguration.current.screenWidthDp.dp * 0.36f)).aspectRatio(2f / 3f).clip(YbRadius.Lg),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
                    Text(detail?.title ?: title, color = YbColor.TextPrimary, fontSize = YbText.Xl2, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    if (detail != null && detail.originalTitle.isNotEmpty() && detail.originalTitle != detail.title) {
                        Text(detail.originalTitle, color = YbColor.TextTertiary, fontSize = YbText.Sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (detail != null) MetaRow(detail)
                }
            }
            Row(
                Modifier.onFocusChanged { if (it.hasFocus) onActionsFocused() }.focusGroup(),
                horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (actions.play != null) PrimaryButton(actions.playLabel, YbIcons.Play, actions.play)
                if (detail != null) {
                    SecondaryButton(
                        if (actions.favorite) "已收藏" else "收藏",
                        icon = if (actions.favorite) YbIcons.HeartFill else YbIcons.Heart,
                        selected = actions.favorite,
                        onClick = actions.toggleFavorite,
                    )
                }
            }
            if (detail != null) {
                if (detail.overview.isNotEmpty()) Overview(detail.overview, collapsible = !wide)
                MetaTable(detail)
            }
        }
    }
}

/** 来源评分角标、年份、时长与类型。 */
@Composable
private fun MetaRow(detail: ViewDetail) {
    val rest = listOf(detail.year, detail.duration, detail.genres.take(3).joinToString(" / "))
        .filter { it.isNotEmpty() }.joinToString(" · ")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(YbSpace.S2), verticalArrangement = Arrangement.spacedBy(YbSpace.S1)) {
        if (detail.rating.isNotEmpty()) {
            RatingBadge(detail.rating)
        }
        if (rest.isNotEmpty()) Text(rest, color = YbColor.TextSecondary, fontSize = YbText.Sm)
    }
}

/** 详情头图以窗口高度留出画面，文字变多时允许内容继续撑高。 */
@Composable
private fun detailHeroMinHeight() = LocalConfiguration.current.screenHeightDp.dp * 0.76f

/** 简介：手机折叠成 3 行，点「展开简介」看全文 */
@Composable
private fun Overview(text: String, collapsible: Boolean, lines: Int = 3, tapToExpand: Boolean = false) {
    var expanded by remember(text) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        Text(
            text,
            color = YbColor.TextSecondary,
            fontSize = YbText.Md,
            maxLines = if (collapsible && !expanded) lines else Int.MAX_VALUE,
            overflow = TextOverflow.Ellipsis,
            // 头图版式（与桌面本地详情页一致）：点简介本身展开 / 收起，不另放链接
            modifier = if (tapToExpand) Modifier.focusFrame(shape = YbRadius.Sm) { expanded = !expanded } else Modifier.tvReadingFocus(),
        )
        if (collapsible && !tapToExpand && text.length > 60) {
            Text(
                if (expanded) "收起简介" else "展开简介",
                color = YbColor.TextPrimary,
                fontSize = YbText.Sm,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.focusFrame(shape = YbRadius.Sm) { expanded = !expanded }.padding(vertical = YbSpace.S1),
            )
        }
    }
}

/** 导演、地区两行（标签灰、内容次级） */
@Composable
private fun MetaTable(detail: ViewDetail) {
    val rows = listOf("导演" to detail.directors, "地区" to detail.countries).filter { it.second.isNotEmpty() }
    Column(Modifier.tvReadingFocus(), verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
        for ((label, values) in rows) {
            Row {
                Text(label, color = YbColor.TextTertiary, fontSize = YbText.Xs, modifier = Modifier.width(40.dp))
                Text(values.joinToString("、"), color = YbColor.TextSecondary, fontSize = YbText.Xs)
            }
        }
    }
}

/** 演员：圆头像加名字，横向滚动 */
@Composable
internal fun CastRow(detail: ViewDetail, client: ServerClient) {
    if (detail.actors.isEmpty()) return
    val gutter = gutter()
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
        Box(Modifier.padding(horizontal = gutter)) { RowTitle("演员") }
        LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S4)) {
            items(detail.actors.take(14)) { actor ->
                Column(Modifier.width(72.dp).tvReadingFocus(YbRadius.Card), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
                    RemoteImage(actor.photo.orEmpty(), client, Modifier.size(72.dp).clip(CircleShape))
                    Text(actor.name, color = YbColor.TextSecondary, fontSize = YbText.Xs, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** 剧照：横卡横向滚动 */
@Composable
internal fun StillsRow(detail: ViewDetail, client: ServerClient) {
    if (detail.images.isEmpty()) return
    val gutter = gutter()
    Column(verticalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
        Box(Modifier.padding(horizontal = gutter)) { RowTitle("剧照") }
        LazyRow(contentPadding = PaddingValues(horizontal = gutter), horizontalArrangement = Arrangement.spacedBy(YbSpace.S3)) {
            items(detail.images.take(20)) { image ->
                RemoteImage(image, client, Modifier.width(220.dp).aspectRatio(16f / 9f).tvReadingFocus(YbRadius.Lg).clip(YbRadius.Lg))
            }
        }
    }
}
