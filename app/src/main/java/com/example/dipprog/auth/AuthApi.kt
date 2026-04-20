package com.example.dipprog.auth

import android.util.Log
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.example.dipprog.api.ApiBaseUrl
import com.example.dipprog.api.ApiHttp
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

object AuthApi {

    private val BASE_URL = ApiBaseUrl.value
    private val client get() = ApiHttp.client
    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class RegisterBody(val email: String, val password: String, val name: String)
    data class LoginBody(val email: String, val password: String)
    data class VerifyEmailBody(val email: String, val code: String)
    data class RegisterPendingResponse(val message: String)
    data class MessageResponse(val message: String)

    data class User(
        val id: Int,
        val email: String,
        val name: String,
        val avatar_url: String? = null,
        val role: String? = "customer",
        @SerializedName("created_at") val createdAt: String? = null
    )

    data class AuthResponse(
        val token: String,
        val user: User
    )

    data class MeResponse(val user: User)

    data class ErrorResponse(
        @SerializedName("error") val error: String?,
        @SerializedName("detail") val detail: String? = null,
    )

    fun register(email: String, password: String, name: String): ApiResult<RegisterPendingResponse> {
        val json = gson.toJson(RegisterBody(email, password, name))
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/register")
            .post(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, RegisterPendingResponse::class.java) }
    }

    fun verifyEmail(email: String, code: String): ApiResult<AuthResponse> {
        val json = gson.toJson(VerifyEmailBody(email, code))
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/verify-email")
            .post(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, AuthResponse::class.java) }
    }

    fun login(email: String, password: String): ApiResult<AuthResponse> {
        return post("$BASE_URL/api/auth/login", LoginBody(email, password))
    }

    fun forgotPassword(email: String): ApiResult<MessageResponse> {
        val json = gson.toJson(mapOf("email" to email))
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/forgot-password")
            .post(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, MessageResponse::class.java) }
    }

    fun resetPassword(email: String, code: String, newPassword: String): ApiResult<MessageResponse> {
        val json = gson.toJson(
            mapOf(
                "email" to email,
                "code" to code,
                "new_password" to newPassword,
            )
        )
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/reset-password")
            .post(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, MessageResponse::class.java) }
    }

    fun me(token: String): ApiResult<MeResponse> {
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/me")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        return execute(request) { gson.fromJson(it, MeResponse::class.java) }
    }

    /**
     * Обновляет профиль.
     * - Только галерея:  name=null, avatarUrl=data:... → отправляет {"avatar_url":"data:..."}
     * - Только имя:      name="...", avatarUrl=null   → отправляет {"name":"..."}  (avatar НЕ трогается)
     * - Имя + URL аватара: оба non-null              → отправляет оба поля
     * - Очистить аватар: name="...", clearAvatar=true → см. перегрузку ниже (если понадобится)
     */
    fun updateProfile(token: String?, name: String? = null, avatarUrl: String? = null): ApiResult<MeResponse> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        // Строим тело вручную — включаем только поля, которые нужно изменить
        val bodyParts = mutableListOf<String>()
        if (name != null) bodyParts.add("\"name\":${gson.toJson(name)}")
        if (avatarUrl != null) bodyParts.add("\"avatar_url\":${gson.toJson(avatarUrl)}")
        if (bodyParts.isEmpty()) return ApiResult.Error("Нет данных для обновления")
        val json = "{${bodyParts.joinToString(",")}}"
        Log.d("AuthApi", "updateProfile JSON size=${json.length} chars")
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/me")
            .addHeader("Authorization", "Bearer $token")
            .patch(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, MeResponse::class.java) }
    }

    private fun post(url: String, body: Any): ApiResult<AuthResponse> {
        val json = gson.toJson(body)
        val request = Request.Builder()
            .url(url)
            .post(json.toRequestBody(jsonType))
            .build()
        return execute(request) { gson.fromJson(it, AuthResponse::class.java) }
    }

    private inline fun <reified T> execute(request: Request, parse: (String) -> T): ApiResult<T> {
        return try {
            val response = client.newCall(request).execute()
            val rawBody = response.body?.string() ?: ""
            Log.d("AuthApi", "HTTP ${response.code} ${request.url}: ${rawBody.take(300)}")
            if (!response.isSuccessful) {
                val err = try {
                    val er = gson.fromJson(rawBody, ErrorResponse::class.java)
                    val base = er?.error ?: "Ошибка ${response.code}"
                    val d = er?.detail?.trim().takeIf { !it.isNullOrBlank() }
                    if (d != null) "$base\n($d)" else base
                } catch (_: Exception) {
                    "HTTP ${response.code}"
                }
                return ApiResult.Error(err)
            }
            ApiResult.Success(parse(rawBody))
        } catch (e: Exception) {
            Log.e("AuthApi", "network error", e)
            ApiResult.Error(e.message ?: "Нет связи с сервером")
        }
    }

    sealed class ApiResult<out T> {
        data class Success<T>(val data: T) : ApiResult<T>()
        data class Error(val message: String) : ApiResult<Nothing>()
    }
}
