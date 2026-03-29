package com.example.dipprog.auth

import android.content.Context
import android.content.SharedPreferences

class SessionManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Токен только в памяти — при «не запоминать» и после перезапуска приложения сбрасывается. */
    private var ephemeralToken: String? = null

    val token: String?
        get() = ephemeralToken ?: prefs.getString(KEY_TOKEN, null)

    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(value) = prefs.edit().putString(KEY_USER_NAME, value).apply()

    var userEmail: String?
        get() = prefs.getString(KEY_USER_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_USER_EMAIL, value).apply()

    var userAvatarUrl: String?
        get() = prefs.getString(KEY_USER_AVATAR, null)
        set(value) = prefs.edit().putString(KEY_USER_AVATAR, value).apply()

    /** Пользователь вошёл по токену (не гость). */
    val isLoggedIn: Boolean
        get() = !token.isNullOrBlank()

    /** Продолжение без аккаунта — каталог и просмотр, без сборок/корзины по API. */
    val isGuestMode: Boolean
        get() = prefs.getBoolean(KEY_GUEST_MODE, false)

    /**
     * Сохранение после входа или регистрации.
     * @param rememberMe если false — токен только до закрытия процесса приложения.
     */
    fun saveUser(token: String, user: AuthApi.User, rememberMe: Boolean) {
        prefs.edit().putBoolean(KEY_GUEST_MODE, false).apply()
        if (rememberMe) {
            ephemeralToken = null
            prefs.edit().putString(KEY_TOKEN, token).apply()
        } else {
            ephemeralToken = token
            prefs.edit().remove(KEY_TOKEN).apply()
        }
        userName = user.name
        userEmail = user.email
        userAvatarUrl = user.avatar_url
    }

    /** Режим гостя: без токена, основной интерфейс доступен. */
    fun enterGuestMode() {
        ephemeralToken = null
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_AVATAR)
            .putBoolean(KEY_GUEST_MODE, true)
            .apply()
    }

    fun logout() {
        ephemeralToken = null
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_AVATAR)
            .putBoolean(KEY_GUEST_MODE, false)
            .apply()
    }

    /** Нужно показать экран входа при старте: нет сохранённой сессии и не выбран гость. */
    fun shouldShowAuthOnLaunch(): Boolean {
        return !isLoggedIn && !isGuestMode
    }

    companion object {
        private const val PREFS_NAME = "auth_prefs"
        private const val KEY_TOKEN = "token"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_USER_AVATAR = "user_avatar_url"
        private const val KEY_GUEST_MODE = "guest_mode"
    }
}
