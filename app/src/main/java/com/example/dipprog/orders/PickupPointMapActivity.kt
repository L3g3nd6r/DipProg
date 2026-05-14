package com.example.dipprog.orders

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.example.dipprog.R
import com.example.dipprog.api.BuildsApi
import com.example.dipprog.auth.SessionManager
import com.example.dipprog.util.launchIo
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.snackbar.Snackbar
import org.osmdroid.config.Configuration
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Снимок выбранной точки выдачи, который возвращает [PickupPointMapActivity] вызывающему. */
data class PickedPickupPoint(
    val id: String,
    val name: String,
    val address: String,
    val city: String,
    val lat: Double,
    val lng: Double,
    val fee: Int,
    val distanceKm: Double,
)

/**
 * Карта выбора точки выдачи (osmdroid + OpenStreetMap, без API-ключа).
 * Возвращает выбранную точку: id, имя, адрес, координаты, стоимость доставки.
 */
class PickupPointMapActivity : AppCompatActivity() {

    private lateinit var map: MapView
    private lateinit var progress: ProgressBar
    private lateinit var infoTitle: TextView
    private lateinit var infoAddress: TextView
    private lateinit var infoFee: TextView
    private lateinit var confirmBtn: MaterialButton

    private var pricing: BuildsApi.PickupPricing? = null
    private var base: BuildsApi.AssemblerBase? = null
    private var points: List<BuildsApi.PickupPoint> = emptyList()
    private val markers = mutableMapOf<String, Marker>()
    private var selectedId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        Configuration.getInstance().load(
            applicationContext,
            getSharedPreferences("osmdroid", Context.MODE_PRIVATE)
        )
        Configuration.getInstance().userAgentValue = packageName
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pickup_point_map)

        val toolbar = findViewById<MaterialToolbar>(R.id.pickupMapToolbar)
        toolbar.setNavigationOnClickListener { finish() }

        map = findViewById(R.id.pickupMapView)
        progress = findViewById(R.id.pickupMapProgress)
        infoTitle = findViewById(R.id.pickupSelectedTitle)
        infoAddress = findViewById(R.id.pickupSelectedAddress)
        infoFee = findViewById(R.id.pickupSelectedFee)
        confirmBtn = findViewById(R.id.pickupConfirmButton)

        map.setTileSource(TileSourceFactory.MAPNIK)
        map.setMultiTouchControls(true)
        map.controller.setZoom(8.0)
        map.controller.setCenter(GeoPoint(54.9024, 52.2974))

        // Тап по «пустой» области — снимаем выбор
        val tapReceiver = object : MapEventsReceiver {
            override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean {
                if (selectedId != null) clearSelection()
                return true
            }
            override fun longPressHelper(p: GeoPoint?): Boolean = false
        }
        map.overlays.add(MapEventsOverlay(tapReceiver))

        confirmBtn.setOnClickListener { confirmAndReturn() }

        val initialId = intent.getStringExtra(EXTRA_INITIAL_POINT_ID)
        loadPoints(initialId)
    }

    override fun onResume() {
        super.onResume()
        map.onResume()
    }

    override fun onPause() {
        map.onPause()
        super.onPause()
    }

    private fun loadPoints(initialId: String?) {
        progress.visibility = View.VISIBLE
        val token = SessionManager(this).token
        launchIo(
            work = { BuildsApi.pickupPoints(token) },
            onMain = { r ->
                progress.visibility = View.GONE
                when (r) {
                    is BuildsApi.ApiResult.Success -> {
                        points = r.data.points
                        base = r.data.assemblerBase
                        pricing = r.data.pricing
                        renderMarkers()
                        if (!initialId.isNullOrBlank()) {
                            selectMarker(initialId, fly = true)
                        }
                    }
                    is BuildsApi.ApiResult.Error -> {
                        Snackbar.make(map, r.message, Snackbar.LENGTH_LONG).show()
                    }
                }
            },
        )
    }

    private fun renderMarkers() {
        markers.values.forEach { map.overlays.remove(it) }
        markers.clear()

        val box = mutableListOf<GeoPoint>()
        for (p in points) {
            val gp = GeoPoint(p.lat, p.lng)
            box += gp
            val marker = Marker(map).apply {
                position = gp
                title = p.name
                snippet = p.address
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                icon = ContextCompat.getDrawable(
                    this@PickupPointMapActivity,
                    R.drawable.ic_pickup_marker
                )
                setOnMarkerClickListener { _, _ ->
                    selectMarker(p.id, fly = false)
                    true
                }
            }
            map.overlays.add(marker)
            markers[p.id] = marker
        }
        map.invalidate()
        if (box.isNotEmpty()) {
            map.post {
                val bb = BoundingBox.fromGeoPoints(box)
                map.zoomToBoundingBox(bb, false, 120)
            }
        }
    }

    private fun selectMarker(id: String, fly: Boolean) {
        val point = points.firstOrNull { it.id == id } ?: return
        selectedId = id
        for ((mid, m) in markers) {
            m.icon = ContextCompat.getDrawable(
                this,
                if (mid == id) R.drawable.ic_pickup_marker_selected else R.drawable.ic_pickup_marker
            )
        }
        infoTitle.text = point.name
        infoAddress.text = point.address
        val fee = computeFee(point)
        val distance = computeDistanceKm(point)
        infoFee.visibility = View.VISIBLE
        infoFee.text = formatFeeLine(fee, distance, point.city)
        confirmBtn.isEnabled = true
        map.invalidate()
        if (fly) {
            map.controller.animateTo(GeoPoint(point.lat, point.lng))
        }
    }

    private fun clearSelection() {
        selectedId = null
        for (m in markers.values) {
            m.icon = ContextCompat.getDrawable(this, R.drawable.ic_pickup_marker)
        }
        infoTitle.setText(R.string.pickup_map_hint_title)
        infoAddress.setText(R.string.pickup_map_hint_subtitle)
        infoFee.visibility = View.GONE
        confirmBtn.isEnabled = false
        map.invalidate()
    }

    private fun confirmAndReturn() {
        val id = selectedId ?: return
        val point = points.firstOrNull { it.id == id } ?: return
        val fee = computeFee(point)
        val distance = computeDistanceKm(point)
        val data = Intent().apply {
            putExtra(EXTRA_RESULT_ID, point.id)
            putExtra(EXTRA_RESULT_NAME, point.name)
            putExtra(EXTRA_RESULT_ADDRESS, point.address)
            putExtra(EXTRA_RESULT_CITY, point.city)
            putExtra(EXTRA_RESULT_LAT, point.lat)
            putExtra(EXTRA_RESULT_LNG, point.lng)
            putExtra(EXTRA_RESULT_FEE, fee)
            putExtra(EXTRA_RESULT_DISTANCE, distance)
        }
        setResult(Activity.RESULT_OK, data)
        finish()
    }

    private fun computeDistanceKm(point: BuildsApi.PickupPoint): Double {
        val b = base ?: return 0.0
        if (point.city.equals(b.city, ignoreCase = true)) return 0.0
        return haversineKm(b.lat, b.lng, point.lat, point.lng)
    }

    private fun computeFee(point: BuildsApi.PickupPoint): Int {
        val pr = pricing ?: return 0
        val b = base ?: return 0
        if (point.city.equals(b.city, ignoreCase = true)) return pr.sameCityFee
        val km = haversineKm(b.lat, b.lng, point.lat, point.lng)
        return (kotlin.math.ceil(km / 10.0) * pr.per10kmFee).toInt()
    }

    private fun formatFeeLine(fee: Int, distance: Double, city: String): String {
        val b = base
        return if (b != null && city.equals(b.city, ignoreCase = true)) {
            getString(R.string.pickup_map_fee_same_city, fee)
        } else {
            getString(R.string.pickup_map_fee_other_city, distance, fee)
        }
    }

    companion object {
        const val EXTRA_INITIAL_POINT_ID = "pickup.initial_id"
        const val EXTRA_RESULT_ID = "pickup.id"
        const val EXTRA_RESULT_NAME = "pickup.name"
        const val EXTRA_RESULT_ADDRESS = "pickup.address"
        const val EXTRA_RESULT_CITY = "pickup.city"
        const val EXTRA_RESULT_LAT = "pickup.lat"
        const val EXTRA_RESULT_LNG = "pickup.lng"
        const val EXTRA_RESULT_FEE = "pickup.fee"
        const val EXTRA_RESULT_DISTANCE = "pickup.distance"

        fun createIntent(context: Context, initialId: String? = null): Intent {
            return Intent(context, PickupPointMapActivity::class.java).apply {
                if (!initialId.isNullOrBlank()) putExtra(EXTRA_INITIAL_POINT_ID, initialId)
            }
        }

        fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val r = 6371.0
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val s1 = sin(dLat / 2)
            val s2 = sin(dLng / 2)
            val a = s1 * s1 + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * s2 * s2
            return 2 * r * atan2(sqrt(a), sqrt(1 - a))
        }

        fun formatKm(value: Double): String =
            String.format(Locale("ru", "RU"), "%.1f", value)
    }
}
