package com.example.dipprog.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val hasToken = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
            .getString("token", null) != null
        val notifsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        val bgMonitor = context.getSharedPreferences("MyPrefs", Context.MODE_PRIVATE)
            .getBoolean("background_monitor_enabled", true)
        if (hasToken && notifsEnabled && bgMonitor) {
            NotificationService.start(context)
        }
    }
}
