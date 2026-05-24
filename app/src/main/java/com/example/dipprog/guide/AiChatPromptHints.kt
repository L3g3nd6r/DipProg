package com.example.dipprog.guide

/**
 * Подсказки для формулировки запроса в ИИ-чат (фильтруются по вводу).
 */
object AiChatPromptHints {

    private val prompts = listOf(
        "Игровой ПК до 80 000 ₽",
        "Офисный ПК до 50 000 ₽",
        "RTX 4060 — хватит для CS2?",
        "Совместимы CPU и матплата?",
        "SSD 512 ГБ или 1 ТБ?",
        "ОЗУ для монтажа видео",
        "ПК для стриминга",
        "B550 или B650?",
        "БП 650 Вт для RTX 4060?",
        "Сборка без видеокарты",
        "Проверь совместимость",
        "Улучшить сборку под 144 Гц",
        "Корпус с вентиляцией",
        "ПК 120 000 ₽ — 3 варианта",
        "Станция для 3D",
    )

    /** До 5 подсказок по введённому тексту; при пустом поле — популярные. */
    fun suggest(input: String): List<String> {
        val q = input.trim().lowercase()
        if (q.isEmpty()) return prompts.take(5)
        val matched = prompts.filter { it.lowercase().contains(q) }
        if (matched.isNotEmpty()) return matched.take(5)
        val words = q.split(Regex("\\s+")).filter { it.length >= 3 }
        if (words.isEmpty()) return prompts.take(5)
        return prompts.filter { p ->
            val lower = p.lowercase()
            words.any { lower.contains(it) }
        }.take(5).ifEmpty { prompts.take(3) }
    }
}
