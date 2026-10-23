package expo.modules.velocitycalls

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * A foreground service that lives exactly as long as a call.
 *
 * Android stops handing an app its microphone the moment the app leaves the
 * screen — the driver opens Google Maps, or presses the power button — unless a
 * foreground service of type "microphone" is running. Without this the other
 * person keeps talking into silence.
 */
class CallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = NotificationCompat.Builder(this, Calls.ONGOING_CHANNEL)
      .setSmallIcon(Calls.icon(this))
      .setContentTitle(intent?.getStringExtra(EXTRA_TITLE) ?: "Velocity Rides call")
      .setContentText(intent?.getStringExtra(EXTRA_TEXT) ?: "Tap to return to the call")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(Calls.openApp(this))
      .build()
    try {
      ServiceCompat.startForeground(
        this,
        ONGOING_ID,
        notification,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0,
      )
    } catch (e: Exception) {
      // The call still runs; it just loses the microphone if the app is left.
      Log.w(LOG_TAG, "startForeground refused", e)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    private const val LOG_TAG = "VelocityCalls"
    private const val ONGOING_ID = 7301
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    /**
     * Android 14 refuses a microphone service without the microphone permission,
     * and crashes an app that asked for one and then could not start it — so
     * this only asks once the permission is already held.
     */
    fun start(context: Context, title: String, text: String): Boolean {
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        return false
      }
      return try {
        Calls.ensureChannels(context)
        ContextCompat.startForegroundService(
          context,
          Intent(context, CallService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text),
        )
        true
      } catch (e: Exception) {
        Log.w(LOG_TAG, "could not start the call service", e)
        false
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CallService::class.java))
    }
  }
}
