package com.example.dipprog.util

import com.google.gson.JsonObject

/** Человекочитаемые подписи к полям specs из API. */
object ComponentSpecFormatter {

    private val labels = mapOf(
        "cores" to "Ядра",
        "threads" to "Потоки",
        "socket" to "Сокет",
        "base_clock_ghz" to "Базовая частота, ГГц",
        "boost_clock_ghz" to "Boost частота, ГГц",
        "tdp_w" to "TDP, Вт",
        "cache_l3_mb" to "Кэш L3, МБ",
        "lithography_nm" to "Техпроцесс, нм",
        "pcie_cpu_version" to "PCIe от CPU",
        "integrated_gpu" to "Встроенная графика",
        "vram" to "Видеопамять, ГБ",
        "vram_gb" to "Видеопамять, ГБ",
        "memory_bus_bit" to "Шина памяти, бит",
        "pcie_slot" to "Слот PCIe",
        "pcie_interface" to "Интерфейс PCIe",
        "length_mm_typical" to "Типичная длина, мм",
        "ray_tracing" to "Трассировка лучей",
        "upscaling" to "Апскейл (DLSS/FSR)",
        "recommended_psu_w" to "Рекомендуемый БП, Вт",
        "size_gb" to "Объём, ГБ",
        "speed_mhz" to "Частота, МГц",
        "type" to "Тип",
        "cas_latency" to "Тайминги (CAS)",
        "voltage" to "Напряжение",
        "form_factor" to "Форм-фактор",
        "channel_mode" to "Режим каналов",
        "channels_note" to "Каналы памяти",
        "chipset" to "Чипсет",
        "ram_type" to "Тип ОЗУ",
        "m2_slots" to "Слотов M.2",
        "sata_ports" to "Портов SATA",
        "pcie_gpu_slot" to "Слот PCIe для GPU",
        "pcie_main" to "PCIe основной слот",
        "wifi_bluetooth" to "Wi‑Fi / Bluetooth",
        "overclocking" to "Разгон",
        "wifi" to "Wi‑Fi",
        "capacity_gb" to "Ёмкость, ГБ",
        "interface" to "Интерфейс",
        "read_seq_mb_s" to "Чтение (послед.), МБ/с",
        "write_seq_mb_s" to "Запись (послед.), МБ/с",
        "nand_type" to "Тип памяти NAND",
        "rpm" to "Обороты, об/мин",
        "cache_mb" to "Кэш, МБ",
        "power_w" to "Мощность, Вт",
        "efficiency" to "Сертификат КПД",
        "efficiency_cert" to "Сертификат 80 Plus",
        "modular_cables" to "Модульные кабели",
        "modular" to "Модульность",
        "protection" to "Защиты",
        "twelve_v_output" to "Линия +12V",
        "pcie_gpu_connectors" to "Разъёмы для GPU",
        "motherboard_support" to "Поддержка плат",
        "max_gpu_length_mm" to "Макс. длина GPU, мм",
        "cpu_cooler_max_height_mm" to "Макс. высота кулера CPU, мм",
        "psu_support" to "Формат БП",
        "fans_included" to "Вентиляторы в комплекте",
        "radiator_front_mm" to "Радиатор спереди, до мм",
        "radiator_support_mm" to "Поддержка радиатора, мм",
    )

    private val order = listOf(
        "socket", "cores", "threads", "base_clock_ghz", "boost_clock_ghz", "tdp_w", "cache_l3_mb",
        "lithography_nm", "pcie_cpu_version", "integrated_gpu",
        "vram", "vram_gb", "memory_bus_bit", "pcie_slot", "pcie_interface", "length_mm_typical",
        "ray_tracing", "upscaling", "recommended_psu_w",
        "type", "size_gb", "speed_mhz", "cas_latency", "voltage", "form_factor", "channel_mode", "channels_note",
        "chipset", "ram_type", "m2_slots", "sata_ports", "pcie_gpu_slot", "pcie_main", "wifi_bluetooth", "overclocking", "wifi",
        "capacity_gb", "interface", "read_seq_mb_s", "write_seq_mb_s", "nand_type", "rpm", "cache_mb",
        "power_w", "efficiency", "efficiency_cert", "modular_cables", "modular", "protection", "twelve_v_output", "pcie_gpu_connectors",
        "motherboard_support", "max_gpu_length_mm", "cpu_cooler_max_height_mm", "psu_support", "fans_included", "radiator_front_mm", "radiator_support_mm",
    )

    fun formatLines(specs: JsonObject?): List<Pair<String, String>> {
        if (specs == null) return emptyList()
        val keys = specs.keySet().toMutableSet()
        val out = mutableListOf<Pair<String, String>>()
        for (k in order) {
            if (!keys.remove(k)) continue
            val v = specs.get(k)?.let { el ->
                when {
                    el.isJsonPrimitive -> {
                        val p = el.asJsonPrimitive
                        if (p.isString) p.asString else p.toString()
                    }
                    el.isJsonNull -> "—"
                    else -> el.toString().trim('"')
                }
            } ?: "—"
            val label = labels[k] ?: k.replace('_', ' ').replaceFirstChar { it.titlecase() }
            out.add(label to v)
        }
        for (k in keys.sorted()) {
            val el = specs.get(k) ?: continue
            val v = when {
                el.isJsonPrimitive -> {
                    val p = el.asJsonPrimitive
                    if (p.isString) p.asString else p.toString()
                }
                el.isJsonNull -> "—"
                else -> el.toString().trim('"')
            }
            val label = labels[k] ?: k.replace('_', ' ').replaceFirstChar { it.titlecase() }
            out.add(label to v)
        }
        return out
    }

    fun formatBlock(specs: JsonObject?): String {
        val lines = formatLines(specs)
        if (lines.isEmpty()) return ""
        return lines.joinToString("\n") { "${it.first}: ${it.second}" }
    }
}
