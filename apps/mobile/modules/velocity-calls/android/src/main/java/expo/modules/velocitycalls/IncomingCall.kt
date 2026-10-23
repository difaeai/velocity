package expo.modules.velocitycalls

import android.Manifest
import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat

/**
 * The ringing phone when the app is not on screen: a call-style notification
 * with Answer and Decline, a looping ringtone, and a full-screen intent that
 * puts the call screen over the lock screen.
 *
 * Answer opens `velocity://call/{id}?answer=1`, which the call screen picks up
 * and answers. Decline only silences this phone: the caller rings out to "No
 * answer", because writing the decline needs the signed-in app.
 */
internal object IncomingCall {
  private const val TAG = "velocity-incoming-call"
  private const val EXTRA_CALL_ID = "callId"

  fun show(context: Context, callId: String, title: String, text: String): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    Calls.ensureChannels(context)
    val id = callId.hashCode()
    val open = Calls.openUri(context, "velocity://call/$callId", id)
    val answer = Calls.openUri(context, "velocity://call/$callId?answer=1", id + 1)
    val decline = PendingIntent.getBroadcast(
      context,
      id + 2,
      Intent(context, DeclineReceiver::class.java).putExtra(EXTRA_CALL_ID, callId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val caller = Person.Builder().setName(title).setImportant(true).build()
    val notification = NotificationCompat.Builder(context, Calls.INCOMING_CHANNEL)
      .setSmallIcon(Calls.icon(context))
      .setContentTitle(title)
      .setContentText(text)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      // The same call can arrive twice (Expo and FCM tokens); ring once.
      .setOnlyAlertOnce(true)
      .setTimeoutAfter(Calls.RING_MS)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
      .build()
    // Ring until answered, declined or timed out — not one chime.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    NotificationManagerCompat.from(context).notify(TAG, id, notification)
    return true
  }

  fun dismiss(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(TAG, callId.hashCode())
  }

  fun callIdOf(intent: Intent): String? = intent.getStringExtra(EXTRA_CALL_ID)
}

class DeclineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    IncomingCall.callIdOf(intent)?.let { IncomingCall.dismiss(context, it) }
  }
}
