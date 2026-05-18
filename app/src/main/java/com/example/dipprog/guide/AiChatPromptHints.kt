package com.example.dipprog.guide

/**
 * Подсказки для формулировки запроса в ИИ-чат (фильтруются по вводу).
 */
object AiChatPromptHints {

    private val prompts = listOf(
        "Подбери игровой ПК на 80 000 ₽",
        "Подбери офисный ПК до 50 000 ₽",
        "Какая видеокарта лучше для CS2 в Full HD?",
        "Совместимы ли эти процессор и материнская плата?",
        "Что выбрать: SSD 512 ГБ или 1 ТБ?",
        "Сколько оперативной памяти нужно для монтажа видео?",
        "Сборка для стриминга на Twitch — с чего начать?",
        "Чем отличается B550 от B650?",
        "Нужен ли блок питания 650 Вт для RTX 4060?",
        "Подбери бюджетную сборку без видеокарты",
        "Проверь мою сборку на совместимость",
        "Что улучшить в сборке для 144 Гц?",
        "Какой корпус лучше для хорошей вентиляции?",
        "Игровой ПК на 120 000 ₽ — варианты",
        "Рабочая станция для 3D — рекомендации",
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
