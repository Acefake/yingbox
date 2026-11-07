package com.yingbox.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job

/** 保存任务由应用页面宿主持有，切换分类或一级页面不会中断服务端与设备的连续写入。 */
internal val LocalSettingsScope = compositionLocalOf<CoroutineScope?> { null }

@Composable
internal fun rememberSettingsScope(): CoroutineScope = LocalSettingsScope.current ?: rememberCoroutineScope()

/** 分类在操作完成后才允许切换，保留正在编辑的状态和成功/失败反馈。 */
internal fun canLeaveSettings(scope: CoroutineScope): Boolean = scope.coroutineContext[Job]?.children?.none { it.isActive } != false
