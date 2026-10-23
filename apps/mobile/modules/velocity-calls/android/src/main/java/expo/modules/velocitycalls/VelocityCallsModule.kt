package expo.modules.velocitycalls

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the app's JavaScript can ask of Android about calls. JS side: modules/velocity-calls/index.ts. */
class VelocityCallsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VelocityCalls")

    Function("startOngoingCall") { title: String, text: String ->
      CallService.start(context, title, text)
    }

    Function("stopOngoingCall") {
      CallService.stop(context)
    }

    Function("showIncomingCall") { callId: String, title: String, text: String ->
      IncomingCall.show(context, callId, title, text)
    }

    Function("dismissIncomingCall") { callId: String ->
      IncomingCall.dismiss(context, callId)
    }

    Function("showOverLockScreen") { enable: Boolean ->
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { Calls.showOverLockScreen(activity, enable) }
      true
    }
  }
}
