package com.example.dipprog.auth

import android.content.Context
import android.content.SharedPreferences

class SessionManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val token: String?
        get() = prefs.getString(KEY_TOKEN, null)

    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(value) = prefs.edit().putString(KEY_USER_NAME, value).apply()

    var userEmail: String?
        get() = prefs.getString(KEY_USER_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_USER_EMAIL, value).apply()

    var userAvatarUrl: String?
        get() = prefs.getString(KEY_USER_AVATAR, null)
        set(value) = prefs.edit().putString(KEY_USER_AVATAR, value).apply()

    var userRole: String?
        get() = prefs.getString(KEY_USER_ROLE, "customer")
        set(value) = prefs.edit().putString(KEY_USER_ROLE, value ?: "customer").apply()

    val isAssembler: Boolean
        get() = userRole.equals("assembler", ignoreCase = true)

    /** Пользователь вошёл по токену (не гость). */
    val isLoggedIn: Boolean
        get() = !token.isNullOrBlank()

    /** Продолжение без аккаунта — каталог и просмотр, без сборок/корзины по API. */
    val isGuestMode: Boolean
        get() = prefs.getBoolean(KEY_GUEST_MODE, false)

    /**
     * Сохранение после входа или регистрации.
     * Токен всегда пишется в [SharedPreferences]: на Android процесс часто перезапускается
     * (свайп с недавних, экономия памяти) — «сессия только в RAM» давала пропадание входа
     * при сохранённом имени профиля (вид «вошёл», но заказы/сборки просили авторизацию).
     * Параметр [rememberMe] оставлен для совместимости вызовов (можно использовать позже).
     */
    @Suppress("UNUSED_PARAMETER")
    fun saveUser(token: String, user: AuthApi.User, rememberMe: Boolean) {
        prefs.edit().putBoolean(KEY_GUEST_MODE, false).apply()
        prefs.edit().putString(KEY_TOKEN, token).apply()
        userName = user.name
        userEmail = user.email
        userAvatarUrl = user.avatar_url
        userRole = user.role ?: "customer"
    }

    /**
     * Если токена нет (старая логика «не запоминать»), а имя почты остались — убираем,
     * чтобы не казалось, что аккаунт активен.
     */
    fun clearOrphanedProfileIfNoToken() {
        if (isGuestMode) return
        if (!token.isNullOrBlank()) return
        if (userName == null && userEmail == null && userAvatarUrl == null) return
        prefs.edit()
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_AVATAR)
            .remove(KEY_USER_ROLE)
            .apply()
    }

    /** Режим гостя: без токена, основной интерфейс доступен. */
    fun enterGuestMode() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_AVATAR)
            .remove(KEY_USER_ROLE)
            .putBoolean(KEY_GUEST_MODE, true)
            .apply()
    }

    fun logout() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_AVATAR)
            .remove(KEY_USER_ROLE)
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
        private const val KEY_USER_ROLE = "user_role"
        private const val KEY_GUEST_MODE = "guest_mode"
    }
}
