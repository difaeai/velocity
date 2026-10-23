package expo.modules.velocitycalls

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.view.WindowManager

/** What the call service and the incoming-call notification share. */
internal object Calls {
  // Channel settings are frozen once created, so a change means a new id.
  const val INCOMING_CHANNEL = "velocity_incoming_call_v1"
  const val ONGOING_CHANNEL = "velocity_ongoing_call_v1"
  /** The caller gives up after 45 s; the ring stops with them. */
  const val RING_MS = 45_000L

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ring = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    manager.createNotificationChannel(
      NotificationChannel(INCOMING_CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Rings when your driver or passenger calls you in the app"
        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), ring)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 600, 800)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(ONGOING_CHANNEL, "Calls in progress", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while you are on a call, so it keeps going outside the app"
      },
    )
  }

  /** The monochrome icon expo-notifications generates, or the app icon. */
  fun icon(context: Context): Int {
    val generated = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (generated != 0) generated else context.applicationInfo.icon
  }

  /** Opens one of the app's own `velocity://` links, which expo-router routes. */
  fun openUri(context: Context, uri: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Brings the app back exactly where it was — the call screen, mid-call. */
  fun openApp(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /**
   * Lets the activity show over the lock screen and wake the display — only while
   * a call screen asks for it, so the rest of the app never opens on a locked phone.
   */
  fun showOverLockScreen(activity: Activity, enable: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(enable)
      activity.setTurnScreenOn(enable)
    } else {
      @Suppress("DEPRECATION")
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (enable) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }
}
