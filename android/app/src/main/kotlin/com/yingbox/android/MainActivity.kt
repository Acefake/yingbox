package com.yingbox.android

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 空壳入口：只证明包能装、能启动，并显示当前设备被识别成电视还是手机。
 * 内嵌 Node 服务、首页和播放器按 ADR-0028 的阶段逐步接入。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val isTv = isTelevision()
        setContent { PlaceholderScreen(isTv) }
    }

    private fun isTelevision(): Boolean {
        val uiMode = getSystemService(UiModeManager::class.java)
        return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }
}

@Composable
private fun PlaceholderScreen(isTv: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .padding(48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = "影盒", color = Color.White, fontSize = 48.sp)
        Text(
            text = if (isTv) "电视模式" else "手机模式",
            color = Color.White,
            fontSize = 20.sp,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}
