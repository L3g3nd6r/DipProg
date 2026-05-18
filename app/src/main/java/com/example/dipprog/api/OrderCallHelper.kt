package com.example.dipprog.api

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object OrderCallHelper {

    private val parsers = listOf(
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        },
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        },
    )

    /** Показывать кнопку «Позвонить» заказчику. */
    fun shouldShowCallButton(order: BuildsApi.Order, isAssembler: Boolean): Boolean {
        if (isAssembler) return false
        if (order.status.equals("cancelled", ignoreCase = true)) return false
        val phone = order.assembler_phone?.trim().orEmpty()
        if (phone.isEmpty()) return false
        return when (order.status?.lowercase(Locale.ROOT)) {
            "new", "sent" -> true
            "received" -> {
                val refMs = parseUtcMs(order.received_at)
                    ?: parseUtcMs(order.completed_at)
                    ?: return false
                System.currentTimeMillis() <= refMs + TimeUnit.DAYS.toMillis(7)
            }
            else -> false
        }
    }

    fun normalizePhoneForDial(raw: String): String {
        return raw.replace(Regex("[^+\\d]"), "")
    }

    private fun parseUtcMs(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        val trimmed = value.trim()
        for (p in parsers) {
            try {
                return p.parse(trimmed)?.time
            } catch (_: Exception) {
                continue
            }
        }
        return null
    }
}
