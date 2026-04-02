package com.example.dipprog.api

import com.example.dipprog.auth.AuthApi
import com.example.dipprog.util.withTunnelHeadersIfNeeded
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object BuildsApi {

    private val BASE_URL = ApiBaseUrl.value
    private val client get() = ApiHttp.client
    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class Category(val id: Int, val name: String, val slug: String, val sort_order: Int?, val max_per_build: Int? = 1)
    data class Component(
        val id: Int,
        val category_id: Int,
        val name: String,
        val description: String?,
        val price: String?,
        val image_url: String?,
        val external_url: String?,
        val category_name: String?,
        val category_slug: String?
    )
    data class ComponentDetail(
        val id: Int,
        val category_id: Int,
        val name: String,
        val description: String?,
        val price: String?,
        val image_url: String?,
        val external_url: String?,
        val specs: JsonObject?,
        val category_name: String?,
        val category_slug: String?
    )
    data class Build(val id: Int, val name: String, val created_at: String?, val updated_at: String?)
    data class BuildComponent(
        val id: Int?,
        val component_id: Int,
        val quantity: Int,
        val name: String,
        val price: String?,
        val category_name: String?,
        val category_slug: String? = null
    )
    data class BuildDetail(
        val id: Int,
        val name: String,
        val created_at: String?,
        val updated_at: String?,
        val components: List<BuildComponent>?,
        val total_price: Number?
    )
    data class CartItem(
        val id: Int?,
        val component_id: Int,
        val quantity: Int,
        val name: String,
        val price: String?,
        val category_name: String?
    )
    data class OrderItem(
        val component_id: Int,
        val name: String,
        val quantity: Int,
        /** В JSON может прийти строка или число. */
        val price: Any? = null
    )
    data class Order(
        val id: Int,
        val user_id: Int,
        val customer_name: String,
        val customer_phone: String,
        val customer_email: String,
        val shipping_address: String,
        val comment: String?,
        val items_json: List<OrderItem>?,
        val total_rub: Number?,
        val status: String,
        val created_at: String?,
        val updated_at: String?,
        val completed_at: String?,
        val received_at: String? = null
    )
    data class OrderNotification(
        val id: Int,
        val title: String,
        val body: String,
        val is_read: Boolean,
        val created_at: String?
    )

    /** Сводная статистика пользователя (GET /api/stats/me). */
    data class UserStatsSummary(
        @SerializedName("builds_count") val buildsCount: Int,
        @SerializedName("cart_lines") val cartLines: Int,
        @SerializedName("cart_quantity") val cartQuantity: Int,
        @SerializedName("cart_total_rub") val cartTotalRub: String,
        @SerializedName("build_component_slots") val buildComponentSlots: Int,
        @SerializedName("member_since") val memberSince: String?
    )

    data class ErrorResp(@SerializedName("error") val error: String?)

    fun categories(token: String?): ApiResult<List<Category>> {
        val req = Request.Builder().url("$BASE_URL/api/categories").get().auth(token).build()
        return getList(req) { gson.fromJson(it, CategoriesWrap::class.java).categories }
    }

    fun components(token: String?, categoryId: Int? = null, search: String? = null): ApiResult<List<Component>> {
        var url = "$BASE_URL/api/components?"
        if (categoryId != null) url += "category_id=$categoryId&"
        if (!search.isNullOrBlank()) url += "search=${java.net.URLEncoder.encode(search, "UTF-8")}&"
        val req = Request.Builder().url(url).get().auth(token).build()
        return getList(req) { gson.fromJson(it, ComponentsWrap::class.java).components }
    }

    fun componentDetail(token: String?, componentId: Int): ApiResult<ComponentDetail> {
        val req = Request.Builder().url("$BASE_URL/api/components/$componentId").get().auth(token).build()
        return getOne(req) { gson.fromJson(it, ComponentDetail::class.java) }
    }

    fun userStats(token: String?): ApiResult<UserStatsSummary> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/stats/me").get().auth(token).build()
        return try {
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                return ApiResult.Error(
                    try {
                        gson.fromJson(body, ErrorResp::class.java)?.error
                    } catch (_: Exception) {
                        null
                    } ?: "Ошибка ${resp.code}"
                )
            }
            val j = JSONObject(body)
            val summary = UserStatsSummary(
                buildsCount = jsonIntFlexible(j, "builds_count"),
                cartLines = jsonIntFlexible(j, "cart_lines"),
                cartQuantity = jsonIntFlexible(j, "cart_quantity"),
                cartTotalRub = j.optString("cart_total_rub", "0").ifBlank { "0" },
                buildComponentSlots = jsonIntFlexible(j, "build_component_slots"),
                memberSince = parseMemberSinceField(j)
            )
            ApiResult.Success(summary)
        } catch (e: Exception) {
            ApiResult.Error(e.message ?: "Нет связи с сервером")
        }
    }

    /** Дата из stats: строка, иногда нестандартный тип в JSON. */
    private fun parseMemberSinceField(j: JSONObject): String? {
        if (!j.has("member_since") || j.isNull("member_since")) return null
        return when (val v = j.get("member_since")) {
            is String -> v.trim().takeIf { it.isNotEmpty() && it != "null" }
            else -> v?.toString()?.trim()?.takeIf { it.isNotEmpty() && it != "null" }
        }
    }

    /** COUNT из PostgreSQL иногда приходит строкой в JSON — не теряем значение. */
    private fun jsonIntFlexible(j: JSONObject, key: String): Int {
        if (!j.has(key) || j.isNull(key)) return 0
        return when (val v = j.get(key)) {
            is Number -> v.toInt()
            is String -> v.toIntOrNull() ?: 0
            else -> 0
        }
    }

    fun builds(token: String?): ApiResult<List<Build>> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds").get().auth(token).build()
        return getList(req) { gson.fromJson(it, BuildsWrap::class.java).builds }
    }

    fun buildDetail(token: String?, buildId: Int): ApiResult<BuildDetail> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId").get().auth(token).build()
        return getOne(req) { gson.fromJson(it, BuildDetail::class.java) }
    }

    data class CompatibilityWarning(val type: String?, val message: String?)
    data class CompatibilityResponse(val warnings: List<CompatibilityWarning>?)

    fun buildCompatibility(token: String?, buildId: Int): ApiResult<CompatibilityResponse> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId/compatibility").get().auth(token).build()
        return getOne(req) { gson.fromJson(it, CompatibilityResponse::class.java) }
    }

    fun createBuild(token: String?, name: String): ApiResult<Build> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(mapOf("name" to name))
        val req = Request.Builder().url("$BASE_URL/api/builds").post(body.toRequestBody(jsonType)).auth(token).build()
        return getOne(req) { gson.fromJson(it, Build::class.java) }
    }

    /** Готовый сценарий с главного экрана: сервер подбирает комплектующие (gaming / workstation). */
    fun createBuildFromPreset(token: String?, name: String, preset: String): ApiResult<Build> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(mapOf("name" to name, "preset" to preset))
        val req = Request.Builder().url("$BASE_URL/api/builds/from-preset").post(body.toRequestBody(jsonType)).auth(token).build()
        return getOne(req) { gson.fromJson(it, Build::class.java) }
    }

    fun deleteBuild(token: String?, buildId: Int): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId").delete().auth(token).build()
        return execute(req)
    }

    fun addToBuild(token: String?, buildId: Int, componentId: Int, quantity: Int = 1): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(mapOf("component_id" to componentId, "quantity" to quantity))
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId/components").post(body.toRequestBody(jsonType)).auth(token).build()
        return execute(req)
    }

    fun removeFromBuild(token: String?, buildId: Int, componentId: Int): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId/components/$componentId").delete().auth(token).build()
        return execute(req)
    }

    fun addBuildToCart(token: String?, buildId: Int): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/builds/$buildId/cart").post("{}".toRequestBody(jsonType)).auth(token).build()
        return execute(req)
    }

    fun cart(token: String?): ApiResult<CartResponse> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/cart").get().auth(token).build()
        return getOne(req) { gson.fromJson(it, CartResponse::class.java) }
    }

    fun addToCart(token: String?, componentId: Int, quantity: Int = 1): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(mapOf("component_id" to componentId, "quantity" to quantity))
        val req = Request.Builder().url("$BASE_URL/api/cart").post(body.toRequestBody(jsonType)).auth(token).build()
        return execute(req)
    }

    fun removeFromCart(token: String?, componentId: Int): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/cart/items/$componentId").delete().auth(token).build()
        return execute(req)
    }

    fun createOrder(
        token: String?,
        customerName: String,
        customerPhone: String,
        customerEmail: String,
        shippingAddress: String,
        comment: String? = null
    ): ApiResult<Order> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(
            mapOf(
                "customer_name" to customerName,
                "customer_phone" to customerPhone,
                "customer_email" to customerEmail,
                "shipping_address" to shippingAddress,
                "comment" to comment
            )
        )
        val req = Request.Builder().url("$BASE_URL/api/orders").post(body.toRequestBody(jsonType)).auth(token).build()
        return getOne(req) { gson.fromJson(it, Order::class.java) }
    }

    fun myOrders(token: String?): ApiResult<List<Order>> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/orders/my").get().auth(token).build()
        return getList(req) { gson.fromJson(it, OrdersWrap::class.java).orders }
    }

    fun assemblerOrders(token: String?): ApiResult<List<Order>> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/orders/assigned").get().auth(token).build()
        return getList(req) { gson.fromJson(it, OrdersWrap::class.java).orders }
    }

    fun completeOrder(token: String?, orderId: Int): ApiResult<Order> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder()
            .url("$BASE_URL/api/orders/$orderId/complete")
            .post("{}".toRequestBody(jsonType))
            .auth(token)
            .build()
        return getOne(req) { gson.fromJson(it, Order::class.java) }
    }

    fun confirmOrderReceipt(token: String?, orderId: Int): ApiResult<Order> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder()
            .url("$BASE_URL/api/orders/$orderId/confirm-receipt")
            .post("{}".toRequestBody(jsonType))
            .auth(token)
            .build()
        return getOne(req) { gson.fromJson(it, Order::class.java) }
    }

    fun myOrderNotifications(token: String?): ApiResult<List<OrderNotification>> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/orders/notifications/my").get().auth(token).build()
        return getList(req) { gson.fromJson(it, NotificationsWrap::class.java).notifications }
    }

    fun markOrderNotificationsRead(token: String?): ApiResult<Unit> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val req = Request.Builder().url("$BASE_URL/api/orders/notifications/read-all").post("{}".toRequestBody(jsonType)).auth(token).build()
        return execute(req)
    }

    // --- ИИ: подбор сборок ---

    data class BuildSuggestion(
        val name: String,
        val description: String?,
        val pros: List<String>?,
        val cons: List<String>?,
        @SerializedName("component_ids") val componentIds: List<Int>
    )

    /** Ответ ИИ: либо текст (приветствие, вопрос), либо подбор сборок, либо оба. */
    data class AiChatResponse(
        val text: String? = null,
        val suggestions: List<BuildSuggestion>? = null
    )

    /** Сообщение в истории чата для контекста ИИ. */
    data class ChatHistoryMessage(val role: String, val content: String)

    private val aiClient = OkHttpClient.Builder()
        .withTunnelHeadersIfNeeded()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    fun buildSuggestions(
        message: String,
        buildSummary: String? = null,
        history: List<ChatHistoryMessage>? = null
    ): ApiResult<AiChatResponse> {
        val bodyMap = mutableMapOf<String, Any>("message" to message)
        if (!buildSummary.isNullOrBlank()) bodyMap["build_summary"] = buildSummary
        if (!history.isNullOrEmpty()) {
            bodyMap["history"] = history.map { mapOf("role" to it.role, "content" to it.content) }
        }
        val body = gson.toJson(bodyMap)
        val req = Request.Builder().url("$BASE_URL/api/ai/build-suggestions").post(body.toRequestBody(jsonType)).build()
        return try {
            val resp = aiClient.newCall(req).execute()
            val bodyStr = resp.body?.string() ?: ""
            if (!resp.isSuccessful) return ApiResult.Error(gson.fromJson(bodyStr, ErrorResp::class.java)?.error ?: "Ошибка ${resp.code}")
            ApiResult.Success(gson.fromJson(bodyStr, AiChatResponse::class.java))
        } catch (e: Exception) {
            ApiResult.Error(e.message ?: "Нет связи с сервером")
        }
    }

    fun createBuildFromSuggestion(token: String?, name: String, componentIds: List<Int>): ApiResult<Build> {
        if (token.isNullOrBlank()) return ApiResult.Error("Требуется авторизация")
        val body = gson.toJson(mapOf("name" to name, "component_ids" to componentIds))
        val req = Request.Builder().url("$BASE_URL/api/builds/from-suggestion").post(body.toRequestBody(jsonType)).auth(token).build()
        return getOne(req) { gson.fromJson(it, Build::class.java) }
    }

    private fun Request.Builder.auth(token: String?): Request.Builder {
        if (!token.isNullOrBlank()) addHeader("Authorization", "Bearer $token")
        return this
    }

    /** Проверяет, что тело ответа выглядит как JSON-объект или массив, а не HTML/текст. */
    private fun bodyErrorOrNull(body: String, code: Int): String? {
        val trimmed = body.trim()
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return try { gson.fromJson(trimmed, ErrorResp::class.java)?.error } catch (_: Exception) { null }
        }
        return "Сервер недоступен (код $code). Попробуйте позже."
    }

    private fun <T> getList(req: Request, parse: (String) -> List<T>): ApiResult<List<T>> {
        return try {
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) return ApiResult.Error(bodyErrorOrNull(body, resp.code) ?: "Ошибка ${resp.code}")
            val trimmed = body.trim()
            if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
                return ApiResult.Error("Сервер недоступен. Попробуйте позже.")
            ApiResult.Success(parse(trimmed))
        } catch (e: Exception) {
            ApiResult.Error("Нет связи с сервером")
        }
    }

    private fun <T> getOne(req: Request, parse: (String) -> T): ApiResult<T> {
        return try {
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) return ApiResult.Error(bodyErrorOrNull(body, resp.code) ?: "Ошибка ${resp.code}")
            val trimmed = body.trim()
            if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
                return ApiResult.Error("Сервер недоступен. Попробуйте позже.")
            ApiResult.Success(parse(trimmed))
        } catch (e: Exception) {
            ApiResult.Error("Нет связи с сервером")
        }
    }

    private fun execute(req: Request): ApiResult<Unit> {
        return try {
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) return ApiResult.Error(bodyErrorOrNull(body, resp.code) ?: "Ошибка ${resp.code}")
            ApiResult.Success(Unit)
        } catch (e: Exception) {
            ApiResult.Error("Нет связи с сервером")
        }
    }

    private data class CategoriesWrap(val categories: List<Category>)
    private data class ComponentsWrap(val components: List<Component>)
    private data class BuildsWrap(val builds: List<Build>)
    private data class OrdersWrap(val orders: List<Order>)
    private data class NotificationsWrap(val notifications: List<OrderNotification>)
    data class CartResponse(val items: List<CartItem>, val total: Number?)

    sealed class ApiResult<out T> {
        data class Success<T>(val data: T) : ApiResult<T>()
        data class Error(val message: String) : ApiResult<Nothing>()
    }
}
