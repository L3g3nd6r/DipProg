package com.example.dipprog.util

import com.example.dipprog.api.BuildsApi

/**
 * ИИ-инспектор только для почти готовой сборки (CPU + матплата + ОЗУ + ещё детали).
 */
object BuildInspectorEligibility {

    private val requiredSlugs = setOf("processors", "motherboard", "ram")
    private const val minComponentCount = 4

    private val slugLabels = mapOf(
        "processors" to "процессор",
        "motherboard" to "материнская плата",
        "ram" to "ОЗУ",
        "gpu" to "видеокарта",
        "storage" to "накопитель",
        "psu" to "блок питания",
        "case" to "корпус"
    )

    data class Result(val allowed: Boolean, val message: String? = null)

    fun check(components: List<BuildsApi.BuildComponent>): Result {
        val slugs = components.mapNotNull { it.category_slug?.trim()?.lowercase() }.toSet()
        val count = components.size

        if (count < 1) {
            return Result(
                false,
                "Сборка пустая. Добавьте комплектующие, затем запустите ИИ-инспектор."
            )
        }

        if (count < minComponentCount) {
            return Result(
                false,
                "В сборке только $count ${pluralComponents(count)}. " +
                    "ИИ-инспектор нужен минимум $minComponentCount позиции: процессор, материнская плата, ОЗУ " +
                    "и ещё детали (накопитель, БП, корпус или видеокарта)."
            )
        }

        if (slugs.size == 1) {
            val only = slugLabels[slugs.first()] ?: slugs.first()
            return Result(
                false,
                "В сборке только $only. ИИ-инспектор не анализирует неполные конфигурации — " +
                    "добавьте процессор, материнскую плату, ОЗУ и другие комплектующие."
            )
        }

        val missing = requiredSlugs - slugs
        if (missing.isNotEmpty()) {
            val names = missing.mapNotNull { slugLabels[it] ?: it }.joinToString(", ")
            return Result(
                false,
                "Для анализа не хватает: $names. " +
                    "Без связки CPU + матплата + ОЗУ отчёт (FPS, узкое место) будет неточным."
            )
        }

        return Result(true)
    }

    private fun pluralComponents(n: Int): String {
        val mod10 = n % 10
        val mod100 = n % 100
        return when {
            mod10 == 1 && mod100 != 11 -> "комплектующее"
            mod10 in 2..4 && (mod100 < 10 || mod100 >= 20) -> "комплектующих"
            else -> "комплектующих"
        }
    }
}
