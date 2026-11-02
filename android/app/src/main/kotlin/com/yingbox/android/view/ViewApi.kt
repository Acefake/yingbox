package com.yingbox.android.view

import com.yingbox.android.server.ServerClient
import org.json.JSONObject

/** 视图域（ADR-0030）：服务端拼好的页面数据。阻塞调用，不要放主线程。 */
class ViewApi(private val client: ServerClient) {
    fun home(): HomeView = HomeView.fromJson(client.call("view", "home") as JSONObject)
}
