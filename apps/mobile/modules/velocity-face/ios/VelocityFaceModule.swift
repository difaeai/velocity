import ExpoModulesCore
import ImageIO
import Vision

/// Which way the face in one photo is pointing. JS side: modules/velocity-face/index.ts.
public class VelocityFaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VelocityFace")

    AsyncFunction("detectFaceAsync") { (uri: String) -> [String: Any] in
      let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
      guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw UnreadablePictureException()
      }
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      let orientation = (properties?[kCGImagePropertyOrientation] as? UInt32)
        .flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up

      // Revision 3 reports yaw as a continuous angle (and adds pitch); older
      // revisions round it to 45° steps, which a slight turn never reaches.
      let request = VNDetectFaceRectanglesRequest()
      request.revision = VNDetectFaceRectanglesRequestRevision3
      try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])

      let faces = request.results ?? []
      var reading: [String: Any] = ["count": faces.count]
      let area = { (face: VNFaceObservation) in face.boundingBox.width * face.boundingBox.height }
      guard let face = faces.max(by: { area($0) < area($1) }) else {
        return reading
      }
      let degrees = { (radians: NSNumber) in radians.doubleValue * 180 / Double.pi }
      if let yaw = face.yaw { reading["yaw"] = degrees(yaw) }
      if let pitch = face.pitch { reading["pitch"] = degrees(pitch) }
      if let roll = face.roll { reading["roll"] = degrees(roll) }
      // Vision measures from the bottom-left; flip so both platforms measure from the top.
      let box = face.boundingBox
      reading["box"] = [
        "x": Double(box.minX),
        "y": Double(1 - box.maxY),
        "width": Double(box.width),
        "height": Double(box.height),
      ]
      return reading
    }
  }
}

internal final class UnreadablePictureException: Exception {
  override var reason: String {
    "Could not read the picture."
  }
}
