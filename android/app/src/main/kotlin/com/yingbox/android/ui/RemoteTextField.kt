package com.yingbox.android.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation

/**
 * 单行文本框。手机上就是普通文本框；电视上先显示成一个可聚焦的按钮（方向键能走过去、走开），
 * 按确定才进入输入并弹出屏幕键盘，输完（完成 / 搜索键）或按返回就收起 —— 否则焦点一落到文本框，
 * 屏幕键盘立刻弹出，方向键全归键盘，焦点再也出不来。
 */
@Composable
internal fun RemoteTextField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboardOptions: KeyboardOptions,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val textStyle = TextStyle(color = YbColor.TextPrimary, fontSize = YbText.Md)
    val tv = LocalIsTv.current
    var editing by remember { mutableStateOf(!tv) }
    val requester = remember { FocusRequester() }
    LaunchedEffect(editing) {
        if (tv && editing) {
            runCatching { requester.requestFocus() }
            keyboard?.show()
        }
    }
    if (!editing) {
        val shown = if (value.isEmpty()) null else visualTransformation.filter(androidx.compose.ui.text.AnnotatedString(value)).text.text
        Text(
            shown ?: "$placeholder（按确定输入）",
            color = if (shown == null) YbColor.TextTertiary else YbColor.TextPrimary,
            fontSize = YbText.Md,
            maxLines = 1,
            modifier = modifier.fillMaxWidth().focusFrame(shape = YbRadius.Sm) { editing = true },
        )
        return
    }
    if (value.isEmpty() && !tv) Text(placeholder, color = YbColor.TextTertiary, fontSize = YbText.Md)
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        visualTransformation = visualTransformation,
        textStyle = textStyle,
        cursorBrush = SolidColor(YbColor.Accent),
        keyboardOptions = keyboardOptions,
        keyboardActions = KeyboardActions(
            onSearch = { finish(keyboard, tv, { editing = false }, onAction) },
            onDone = { finish(keyboard, tv, { editing = false }, onAction) },
        ),
        modifier = modifier
            .fillMaxWidth()
            .focusRequester(requester)
            // 按返回收起键盘后焦点会离开文本框：回到按钮状态
            .onFocusChanged { if (tv && !it.isFocused && editing) editing = false }
            .dpadVerticalFocus(),
    )
}

private fun finish(
    keyboard: androidx.compose.ui.platform.SoftwareKeyboardController?,
    tv: Boolean,
    leave: () -> Unit,
    action: () -> Unit,
) {
    keyboard?.hide()
    if (tv) leave()
    action()
}
