package com.example.dipprog.auth

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.example.dipprog.api.ApiHttp
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

object AuthApi {

    private val BASE_URL = com.example.dipprog.BuildConfig.BASE_URL
    private val client get() = ApiHttp.client
    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class RegisterBody(val email: String, val password: String, val name: String)
    data class LoginBody(val email: String, val password: String)

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
        @SerializedName("error") val error: String?
    )

    fun register(email: String, password: String, name: String): ApiResult<AuthResponse> {
        return post("$BASE_URL/api/auth/register", RegisterBody(email, password, name))
    }

    fun login(email: String, password: String): ApiResult<AuthResponse> {
        return post("$BASE_URL/api/auth/login", LoginBody(email, password))
    }

    fun me(token: String): ApiResult<MeResponse> {
        val request = Request.Builder()
            .url("$BASE_URL/api/auth/me")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()
        return execute(request) { gson.fromJson(it, MeResponse::class.java) }
    }

    fun updateProfile(token: String?, name: String? = null, avatarUrl: String? = null): ApiResult<MeResponse> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = mutableMapOf<String, Any?>()
        name?.let { body["name"] = it }
        body["avatar_url"] = avatarUrl
        val json = gson.toJson(body)
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
            val body = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                val err = try {
                    gson.fromJson(body, ErrorResponse::class.java)?.error ?: "Ошибка ${response.code}"
                } catch (_: Exception) {
                    "Ошибка ${response.code}"
                }
                return ApiResult.Error(err)
            }
            ApiResult.Success(parse(body))
        } catch (e: Exception) {
            ApiResult.Error(e.message ?: "Нет связи с сервером")
        }
    }

    sealed class ApiResult<out T> {
        data class Success<T>(val data: T) : ApiResult<T>()
        data class Error(val message: String) : ApiResult<Nothing>()
    }
}
