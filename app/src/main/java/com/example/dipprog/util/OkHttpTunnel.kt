package com.example.dipprog.util

import com.example.dipprog.api.ApiBaseUrl
import okhttp3.OkHttpClient

/** Бесплатный ngrok отдаёт HTML-заглушку без этого заголовка — API ломается. */
fun OkHttpClient.Builder.withTunnelHeadersIfNeeded(): OkHttpClient.Builder {
    if (ApiBaseUrl.value.contains("ngrok", ignoreCase = true)) {
        addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("ngrok-skip-browser-warning", "true")
                    .build(),
            )
        }
    }
    return this
}
