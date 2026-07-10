package expo.modules.audiocapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Android 14+ 要求：使用 MediaProjection 必须有一个
 * FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION 类型的前台服务在运行。
 *
 * 本服务不做实际采集——只作为"凭证"满足系统要求。
 */
class MediaProjectionService : Service() {

  companion object {
    const val CHANNEL_ID = "audio_capture_media_projection"
    const val NOTIFICATION_ID = 2001
    /** 供 AudioCaptureModule 查询服务是否在运行 */
    @Volatile
    var isRunning: Boolean = false
      private set
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    isRunning = true

    val notification = buildNotification()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+ 必须指定 foregroundServiceType
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  // ── helpers ──

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "音频采集",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "系统音频采集服务运行中"
      }
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    // 构造一个空的 PendingIntent（不会跳转）
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    return Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("音频采集运行中")
      .setContentText("正在采集系统音频…")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .build()
  }
}
