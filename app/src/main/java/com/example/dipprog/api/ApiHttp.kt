package com.example.dipprog.api

import com.example.dipprog.util.withTunnelHeadersIfNeeded
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Единый клиент для API: пул соединений, таймауты, ngrok-заголовок. */
object ApiHttp {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .withTunnelHeadersIfNeeded()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
