package com.example.dipprog.api

import android.content.Context
import com.example.dipprog.BuildConfig

/**
 * Базовый URL API: по умолчанию из [BuildConfig] (local.properties при сборке),
 * при необходимости переопределяется в настройках (ngrok, облако) без пересборки APK.
 */
object ApiConfig {

    private const val PREFS = "dipprog_api"
    private const val KEY_OVERRIDE = "base_url_override"

    @Volatile
    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun baseUrl(): String {
        val ctx = appContext ?: return BuildConfig.BASE_URL.trimEnd('/')
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_OVERRIDE, null)?.trim().orEmpty()
        val url = if (raw.isNotEmpty()) raw else BuildConfig.BASE_URL
        return url.trimEnd('/')
    }

    /** Ненулевой, если пользователь задал свой адрес в настройках. */
    fun getOverride(): String? =
        appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            ?.getString(KEY_OVERRIDE, null)?.trim()?.takeIf { it.isNotEmpty() }

    fun setOverride(url: String?) {
        val ctx = appContext ?: return
        val ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (url.isNullOrBlank()) {
            ed.remove(KEY_OVERRIDE)
        } else {
            ed.putString(KEY_OVERRIDE, url.trim().trimEnd('/'))
        }
        ed.apply()
    }

    fun defaultBaseUrl(): String = BuildConfig.BASE_URL.trimEnd('/')
}
