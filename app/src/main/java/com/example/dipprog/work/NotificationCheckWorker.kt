package com.example.dipprog.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.dipprog.MainActivity
import com.example.dipprog.R
import com.example.dipprog.api.BuildsApi

class NotificationCheckWorker(
    private val ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    companion object {
        const val WORK_NAME = "notif_check_periodic"
        private const val CHANNEL_ID = "order_notifications"
        private const val CHANNEL_NAME = "Уведомления о заказах"
        private const val PREFS_NAME = "notif_worker_prefs"
        private const val KEY_LAST_NOTIF_ID = "last_bg_notif_id"
    }

    override suspend fun doWork(): Result {
        val token = readToken() ?: return Result.success()
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return Result.success()

        ensureChannel()

        val apiResult = BuildsApi.myOrderNotifications(token)
        if (apiResult is BuildsApi.ApiResult.Success) {
            val list = apiResult.data
            val lastSeenId = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getInt(KEY_LAST_NOTIF_ID, 0)
            val newUnread = list.filter { !it.is_read && it.id > lastSeenId }
            for (notif in newUnread) {
                showNotification(notif.title, notif.body, notif.id)
            }
            if (newUnread.isNotEmpty()) {
                ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putInt(KEY_LAST_NOTIF_ID, newUnread.maxOf { it.id })
                    .apply()
            }
        }
        return Result.success()
    }

    private fun readToken(): String? {
        val prefs = ctx.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
        return prefs.getString("token", null)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Изменения статуса заказов"
                }
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun showNotification(title: String, body: String, notifId: Int) {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            ctx, notifId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notifications)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, notification)
    }
}
