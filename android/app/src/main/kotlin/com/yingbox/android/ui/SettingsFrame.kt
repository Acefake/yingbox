package com.yingbox.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** 设置分类沿用客户端语义，只列安卓已实现的能力。 */
internal enum class SettingsSection(val title: String, val icon: ImageVector, val keywords: String) {
    Appearance("外观", YbIcons.Sun, "品牌 配色 透明度 玻璃"),
    Scrape("刮削", YbIcons.Download, "元数据 语言 TMDB 图片 清晰度"),
    Network("网络优化", YbIcons.Globe, "代理 镜像 GitHub"),
    Sources("在线源", YbIcons.Database, "站点 检测 测速"),
    Player("播放器", YbIcons.Play, "自动 下一集 换源"),
    Nas("NAS 连接", YbIcons.Cloud, "片库 服务器 地址 令牌"),
    About("关于与更新", YbIcons.Info, "版本 升级"),
}

/** 自适应设置外壳；内容滚动与分类滚动相互独立。 */
@Composable
internal fun SettingsFrame(
    layout: AdaptiveLayout,
    active: SettingsSection?,
    categoriesFocus: FocusRequester,
    contentFocus: FocusRequester,
    onContentFocus: (Boolean) -> Unit,
    onBack: () -> Unit,
    onSelect: (SettingsSection) -> Unit,
    content: @Composable (SettingsSection) -> Unit,
) {
    val wide = layout != AdaptiveLayout.Phone
    val tv = layout == AdaptiveLayout.Tv
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(YbSpace.S4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
    ) {
        if (!wide && active != null) GlassIconButton(YbIcons.Back, "返回设置分类", onClick = onBack)
        Text(if (wide || active == null) "设置" else active.title, color = YbColor.TextPrimary, fontSize = YbText.Xl2, fontWeight = FontWeight.SemiBold)
    }
    Row(Modifier.fillMaxSize()) {
        if (wide || active == null) {
            SettingsCategories(
                active,
                if (wide) Modifier.width(if (tv) 224.dp else 184.dp) else Modifier.fillMaxWidth(),
                categoriesFocus, onSelect,
            )
        }
        if (active != null) {
            Column(
                Modifier.weight(1f).focusRequester(contentFocus)
                    .onFocusChanged { onContentFocus(it.hasFocus) }.focusGroup(),
            ) {
                if (wide) Text(active.title, Modifier.padding(horizontal = YbSpace.S4, vertical = YbSpace.S3), color = YbColor.TextPrimary, fontSize = if (tv) YbText.Xl2 else YbText.Xl, fontWeight = FontWeight.SemiBold)
                content(active)
            }
        }
    }
}

@Composable
private fun SettingsCategories(active: SettingsSection?, modifier: Modifier, focus: FocusRequester, select: (SettingsSection) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val sections = SettingsSection.entries.filter { "${it.title} ${it.keywords}".contains(query.trim(), ignoreCase = true) }
    val tv = LocalIsTv.current
    val focusSection = active?.takeIf { it in sections } ?: sections.firstOrNull()
    Column(modifier.padding(horizontal = YbSpace.S3).focusGroup()) {
        Box(Modifier.fillMaxWidth().padding(bottom = YbSpace.S4).background(YbColor.Active, YbRadius.Md).padding(YbSpace.S3)) {
            RemoteTextField(query, { query = it }, "搜索设置", KeyboardOptions.Default, {}, modifier = if (sections.isEmpty()) Modifier.focusRequester(focus) else Modifier)
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(YbSpace.S2)) {
            items(sections, key = { it.name }) { section ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = if (tv) 60.dp else 48.dp)
                        .then(if (section == focusSection) Modifier.focusRequester(focus) else Modifier)
                        .tvFocusViewport().focusFrame(shape = YbRadius.Md, selected = section == active) { select(section) }
                        .padding(horizontal = YbSpace.S3, vertical = YbSpace.S3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(YbSpace.S3),
                ) {
                    Icon(section.icon, null, tint = YbColor.TextPrimary, modifier = Modifier.size(if (tv) 24.dp else 20.dp))
                    Text(section.title, Modifier.weight(1f), color = YbColor.TextPrimary, fontSize = if (tv) YbText.Lg else YbText.Md)
                    if (active == null) Icon(YbIcons.Forward, null, tint = YbColor.TextTertiary, modifier = Modifier.size(14.dp))
                }
            }
            if (sections.isEmpty()) item { Text("没有匹配的设置", color = YbColor.TextTertiary, fontSize = YbText.Sm, modifier = Modifier.padding(YbSpace.S3)) }
        }
    }
}
