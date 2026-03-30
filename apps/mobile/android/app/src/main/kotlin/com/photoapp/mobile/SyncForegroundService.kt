package com.photoapp.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Android Foreground Service for active photo backup.
 *
 * The service is started from Flutter via a MethodChannel when the user taps
 * "Back up now" or when WorkManager decides to do an active sync. It keeps
 * the process alive and shows a persistent notification with upload progress.
 *
 * Flutter (Dart) calls:
 *   - startForeground()  → starts this service
 *   - updateProgress(done, total, fileName) → updates the notification
 *   - stopForeground()   → stops this service
 *
 * The actual upload logic lives in Flutter/Dart (SyncService). This service
 * just holds the wakelock and shows the notification so the OS doesn't kill
 * the process mid-upload on Android 8+.
 */
class SyncForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "photoapp_sync"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_DONE = "done"
        const val EXTRA_TOTAL = "total"
        const val EXTRA_FILE_NAME = "file_name"

        fun buildStartIntent(context: Context, done: Int = 0, total: Int = 0, fileName: String = ""): Intent =
            Intent(context, SyncForegroundService::class.java).apply {
                putExtra(EXTRA_DONE, done)
                putExtra(EXTRA_TOTAL, total)
                putExtra(EXTRA_FILE_NAME, fileName)
            }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val done = intent?.getIntExtra(EXTRA_DONE, 0) ?: 0
        val total = intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0
        val fileName = intent?.getStringExtra(EXTRA_FILE_NAME) ?: ""

        val notification = buildNotification(done, total, fileName)
        startForeground(NOTIFICATION_ID, notification)

        // If total == 0 and done == 0 with a special sentinel, stop the service
        if (total == -1) {
            stopSelf()
        }

        // START_NOT_STICKY: if the process is killed, don't restart — the next
        // WorkManager run will catch up.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        // WorkManager handles re-scheduling; nothing to do here.
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Photo Backup",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress while backing up your photos"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(done: Int, total: Int, fileName: String) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Backing up photos…")
            .setContentText(
                if (fileName.isNotEmpty()) "Uploading: $fileName"
                else if (total > 0) "$done / $total photos"
                else "Preparing…"
            )
            .setSmallIcon(android.R.drawable.ic_menu_upload)
            .setOngoing(true)
            .setProgress(total, done, total == 0)
            .apply {
                // Tap → open the app
                val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                if (launchIntent != null) {
                    setContentIntent(
                        PendingIntent.getActivity(
                            this@SyncForegroundService, 0, launchIntent,
                            PendingIntent.FLAG_IMMUTABLE
                        )
                    )
                }
            }
            .build()
}
