package com.example.dipprog.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.example.dipprog.MainActivity
import com.example.dipprog.R
import com.example.dipprog.api.BuildsApi

class NotificationService : Service() {

    companion object {
        private const val TAG = "NotifService"
        private const val FOREGROUND_ID = 90001
        private const val SERVICE_CHANNEL_ID = "notif_service_channel"
        private const val ORDER_CHANNEL_ID = "order_notifications"
        private const val PREFS_NAME = "notif_worker_prefs"
        private const val KEY_LAST_NOTIF_ID = "last_bg_notif_id"
        private const val POLL_INTERVAL_MS = 30_000L

        fun start(context: Context) {
            val intent = Intent(context, NotificationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NotificationService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val pollRunnable = object : Runnable {
        override fun run() {
            pollNotifications()
            handler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        ensureServiceChannel()
        ensureOrderChannel()
        startForeground(FOREGROUND_ID, buildForegroundNotification())
        handler.post(pollRunnable)
        Log.d(TAG, "Service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(pollRunnable)
        Log.d(TAG, "Service stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun pollNotifications() {
        Thread {
            try {
                val token = readToken()
                if (token == null) {
                    Log.d(TAG, "No token, skipping poll")
                    return@Thread
                }
                if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return@Thread

                val result = BuildsApi.myOrderNotifications(token)
                if (result is BuildsApi.ApiResult.Success) {
                    val list = result.data
                    val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    val lastSeenId = prefs.getInt(KEY_LAST_NOTIF_ID, 0)
                    val newUnread = list.filter { !it.is_read && it.id > lastSeenId }
                    for (notif in newUnread) {
                        showOrderNotification(notif.title, notif.body, notif.id)
                    }
                    if (newUnread.isNotEmpty()) {
                        prefs.edit().putInt(KEY_LAST_NOTIF_ID, newUnread.maxOf { it.id }).apply()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Poll error", e)
            }
        }.start()
    }

    private fun readToken(): String? {
        return getSharedPreferences("auth_prefs", MODE_PRIVATE).getString("token", null)
    }

    private fun ensureServiceChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(SERVICE_CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    SERVICE_CHANNEL_ID,
                    "Мониторинг заказов",
                    NotificationManager.IMPORTANCE_MIN,
                ).apply {
                    description = "Фоновая проверка статусов заказов"
                    setShowBadge(false)
                }
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun ensureOrderChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(ORDER_CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    ORDER_CHANNEL_ID,
                    "Уведомления о заказах",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply { description = "Изменения статуса заказов" }
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun buildForegroundNotification(): android.app.Notification {
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notifications)
            .setContentTitle("PC Forge")
            .setContentText("Мониторинг заказов активен")
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
    }

    private fun showOrderNotification(title: String, body: String, notifId: Int) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, notifId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, ORDER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notifications)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(notifId, notification)
    }
}
