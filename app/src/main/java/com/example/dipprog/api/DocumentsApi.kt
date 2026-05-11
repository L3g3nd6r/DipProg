package com.example.dipprog.api

import com.google.gson.Gson
import okhttp3.Request

/**
 * Документы пользователя: акт приёма заказа и др.
 * Список идёт JSON-ом, скачивание — бинарным телом (HTML, открывается как Word .doc).
 */
object DocumentsApi {

    private val BASE_URL = ApiBaseUrl.value
    private val client get() = ApiHttp.client
    private val gson = Gson()

    data class Document(
        val id: Int,
        val order_id: Int?,
        val kind: String,
        val title: String,
        val file_name: String,
        val mime_type: String,
        val created_at: String?,
    )

    private data class DocumentsWrap(val documents: List<Document>)
    private data class ErrorResp(val error: String?)

    sealed class Result<out T> {
        data class Success<T>(val data: T) : Result<T>()
        data class Error(val message: String) : Result<Nothing>()
    }

    /** Класс с метаданными скачанного файла. */
    data class DownloadedFile(
        val bytes: ByteArray,
        val fileName: String,
        val mimeType: String,
    )

    private fun userMessageForHttp(code: Int, fallback: String? = null): String {
        return when (code) {
            401 -> "Сессия истекла. Войдите снова."
            403 -> "Нет доступа к документам этого аккаунта."
            404 -> "Раздел документов недоступен на сервере (backend не обновлён)."
            else -> fallback ?: "Ошибка $code"
        }
    }

    fun list(token: String?): Result<List<Document>> {
        if (token.isNullOrBlank()) return Result.Error("Требуется авторизация")
        val req = Request.Builder()
            .url("$BASE_URL/api/documents")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()
        return try {
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            if (!resp.isSuccessful) {
                val err = try {
                    gson.fromJson(body, ErrorResp::class.java)?.error
                } catch (_: Exception) {
                    null
                }
                return Result.Error(userMessageForHttp(resp.code, err))
            }
            val list = gson.fromJson(body, DocumentsWrap::class.java).documents
            Result.Success(list)
        } catch (e: Exception) {
            Result.Error(e.message ?: "Нет связи с сервером")
        }
    }

    fun download(token: String?, documentId: Int): Result<DownloadedFile> {
        if (token.isNullOrBlank()) return Result.Error("Требуется авторизация")
        val req = Request.Builder()
            .url("$BASE_URL/api/documents/$documentId/download")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()
        return try {
            val resp = client.newCall(req).execute()
            if (!resp.isSuccessful) {
                resp.body?.close()
                return Result.Error(userMessageForHttp(resp.code))
            }
            val bytes = resp.body?.bytes() ?: ByteArray(0)
            val mime = resp.header("Content-Type") ?: "application/msword"
            val cleanMime = mime.substringBefore(';').trim().ifEmpty { "application/msword" }
            val cd = resp.header("Content-Disposition")
            val fileName = parseFileNameFromContentDisposition(cd) ?: "document-$documentId.doc"
            Result.Success(DownloadedFile(bytes, fileName, cleanMime))
        } catch (e: Exception) {
            Result.Error(e.message ?: "Нет связи с сервером")
        }
    }

    fun delete(token: String?, documentId: Int): Result<Unit> {
        if (token.isNullOrBlank()) return Result.Error("Требуется авторизация")
        val req = Request.Builder()
            .url("$BASE_URL/api/documents/$documentId")
            .delete()
            .addHeader("Authorization", "Bearer $token")
            .build()
        return try {
            val resp = client.newCall(req).execute()
            resp.body?.close()
            if (!resp.isSuccessful) Result.Error(userMessageForHttp(resp.code)) else Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e.message ?: "Нет связи с сервером")
        }
    }

    private fun parseFileNameFromContentDisposition(header: String?): String? {
        if (header.isNullOrBlank()) return null
        // RFC 5987: filename*=UTF-8''...
        Regex("""filename\*\s*=\s*UTF-8''([^;]+)""", RegexOption.IGNORE_CASE)
            .find(header)?.let {
                return try {
                    java.net.URLDecoder.decode(it.groupValues[1].trim(), "UTF-8")
                } catch (_: Exception) {
                    null
                }
            }
        Regex("""filename\s*=\s*"?([^";]+)"?""", RegexOption.IGNORE_CASE)
            .find(header)?.let { return it.groupValues[1].trim() }
        return null
    }
}
