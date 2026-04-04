package com.example.dipprog.api

import com.example.dipprog.BuildConfig

/**
 * Базовый URL API из [BuildConfig.BASE_URL] (`api.base.url` в local.properties).
 * Если забыли префикс `https://`, подставляется автоматически (иначе OkHttp падает).
 * Локальные хосты без схемы получают `http://`.
 */
object ApiBaseUrl {

    val value: String = normalize(BuildConfig.BASE_URL)

    private fun normalize(raw: String): String {
        val t = raw.trim().trimEnd('/')
        if (t.isEmpty()) return "http://10.0.2.2:3000"
        val lower = t.lowercase()
        if (lower.startsWith("http://") || lower.startsWith("https://")) return t
        val hostPart = t.substringBefore('/').substringBefore(':').lowercase()
        val isLocal =
            hostPart == "localhost" ||
                hostPart == "127.0.0.1" ||
                hostPart == "10.0.2.2" ||
                hostPart.matches(Regex("""^\d{1,3}(\.\d{1,3}){3}$"""))
        return if (isLocal) "http://$t" else "https://$t"
    }
}
