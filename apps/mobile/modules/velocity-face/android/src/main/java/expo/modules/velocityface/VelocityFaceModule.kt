package expo.modules.velocityface

import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Long edge a picture is shrunk to before it is read: plenty to find a face at arm's length. */
private const val READ_EDGE = 640

/** Which way the face in one photo is pointing. JS side: modules/velocity-face/index.ts. */
class VelocityFaceModule : Module() {
  // Built once: creating a detector loads the model.
  private val detector = lazy {
    FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .build()
    )
  }

  override fun definition() = ModuleDefinition {
    Name("VelocityFace")

    AsyncFunction("detectFaceAsync") { uri: String, promise: Promise ->
      val path = Uri.parse(uri).path ?: uri
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= READ_EDGE) sample *= 2
      val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
      if (bitmap == null) {
        promise.reject("ERR_FACE_IMAGE", "Could not read the picture.", null)
        return@AsyncFunction
      }
      val rotation = when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
      // Results come back in the upright picture's coordinates.
      val width = (if (rotation % 180 == 0) bitmap.width else bitmap.height).toDouble()
      val height = (if (rotation % 180 == 0) bitmap.height else bitmap.width).toDouble()

      detector.value.process(InputImage.fromBitmap(bitmap, rotation))
        .addOnSuccessListener { faces ->
          val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
          val reading = mutableMapOf<String, Any>("count" to faces.size)
          if (face != null) {
            val box = face.boundingBox
            reading["yaw"] = face.headEulerAngleY.toDouble()
            reading["pitch"] = face.headEulerAngleX.toDouble()
            reading["roll"] = face.headEulerAngleZ.toDouble()
            reading["box"] = mapOf(
              "x" to box.left / width,
              "y" to box.top / height,
              "width" to box.width() / width,
              "height" to box.height() / height
            )
          }
          promise.resolve(reading)
        }
        .addOnFailureListener { e -> promise.reject("ERR_FACE_DETECTION", e.message, e) }
    }

    OnDestroy {
      if (detector.isInitialized()) detector.value.close()
    }
  }
}
