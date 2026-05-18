package com.example.dipprog.util

import com.example.dipprog.api.BuildsApi
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Тарифы доставки (синхронно с backend/services/pickup-points.js). */
object DeliveryFeeCalculator {

    private const val BASE_LAT = 54.9024
    private const val BASE_LNG = 52.2974
    private const val BASE_CITY = "Альметьевск"
    const val SAME_CITY_FEE = 400

    private val tiers = listOf(
        30.0 to 220,
        55.0 to 280,
        85.0 to 340,
        120.0 to 390,
        160.0 to 450,
        220.0 to 520,
        Double.MAX_VALUE to 590,
    )

    data class Result(val fee: Int, val distanceKm: Double)

    fun compute(point: BuildsApi.PickupPoint): Result {
        if (point.city.equals(BASE_CITY, ignoreCase = true)) {
            return Result(SAME_CITY_FEE, 0.0)
        }
        val km = haversineKm(BASE_LAT, BASE_LNG, point.lat, point.lng)
        return Result(feeByDistanceKm(km), (kotlin.math.round(km * 10) / 10.0))
    }

    fun feeByDistanceKm(km: Double): Int {
        for ((maxKm, fee) in tiers) {
            if (km <= maxKm) return fee
        }
        return 590
    }

    fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val sLat = sin(dLat / 2)
        val sLng = sin(dLng / 2)
        val a = sLat.pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sLng.pow(2)
        return 2 * r * asin(sqrt(a))
    }
}
